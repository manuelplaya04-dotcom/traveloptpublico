"""travelopt-devtools: servidor MCP (stdio) que estandariza cómo Claude prueba el sistema local.

Herramientas:
  engine_health                 estado del motor
  create_fixture_run            crea una corrida fixture (por defecto sin disparar n8n)
  run_extraction_inprocess      plan + extract x5 en paralelo sin n8n; informa el status de optimize
  run_fixture_inprocess         corrida fixture sin n8n (POST /run-all) + verificación contra golden
  e2e_via_n8n                   corrida fixture disparando n8n + espera + verificación contra golden
  wait_for_run                  sondea una corrida hasta estado terminal
  n8n_fire_webhook              dispara un webhook (producción o test) con el secreto correcto
  n8n_executions / n8n_execution  lee ejecuciones vía API pública de n8n (resumidas)

Se niega a operar contra hosts no locales salvo DEVTOOLS_ALLOW_REMOTE=1.
Lee la configuración del .env de la raíz del repo (nunca la devuelve al modelo).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import quote, urlparse

import httpx
from dotenv import load_dotenv
from mcp.server.mcpserver import MCPServer
from pydantic import Field

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")
logging.getLogger("httpx").setLevel(logging.WARNING)  # stdout es el canal MCP: nada de ruido

ENGINE = os.getenv("ENGINE_BASE_URL", "http://localhost:8000").rstrip("/")
N8N = os.getenv("N8N_BASE_URL", "http://localhost:5678").rstrip("/")
TERMINAL = {"done", "infeasible", "failed"}
KINDS = ("flights", "lodging", "activities", "weather", "transport")
Mode = Literal["fixture", "hybrid", "live"]
TimeoutS = Annotated[int, Field(ge=1, le=300)]

server = MCPServer(
    "travelopt-devtools",
    instructions="Herramientas de prueba del sistema TravelOpt (motor FastAPI + n8n) en entorno local.",
)


def _guard(url: str) -> None:
    host = urlparse(url).hostname or ""
    local = host in {"localhost", "127.0.0.1", "::1", "host.docker.internal"} or host.endswith(".localhost")
    if not local and os.getenv("DEVTOOLS_ALLOW_REMOTE") != "1":
        raise RuntimeError(f"host no local bloqueado: {host} (exportar DEVTOOLS_ALLOW_REMOTE=1 para permitirlo)")


def _case(case_key: str) -> str:
    """case_key llega del modelo: se valida antes de usarlo en una URL o en una ruta de archivo."""
    # patrón: espejo de engine/app/domain/models.py::CASE_KEY_PATTERN (otro runtime)
    if not isinstance(case_key, str) or not re.fullmatch(r"[a-z0-9_]{1,64}", case_key):
        raise ValueError("case_key inválido (solo [a-z0-9_], 1 a 64 caracteres)")
    return case_key


def _q(segment: str) -> str:
    """Escapa un valor para interpolarlo como UN segmento de ruta (también codifica / y ..)."""
    return quote(str(segment), safe="")


def _engine_headers() -> dict:
    return {"Authorization": f"Bearer {os.environ['ENGINE_API_KEY']}"}


def _golden(case_key: str) -> dict:
    path = ROOT / "engine" / "fixtures" / _case(case_key) / "expected.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _verdict(run: dict, golden: dict) -> dict:
    its = run.get("itineraries") or []
    checks = {"status_done": run.get("status") == "done"}
    if golden and its:
        checks["best_total"] = its[0]["total_minor"] == golden["best_total_minor"]
        checks["best_skeleton"] = its[0]["skeleton_id"] == golden["best_skeleton_id"]
        checks["top_totals"] = [i["total_minor"] for i in its] == golden["top_totals_minor"]
        checks["breakdown_reconciles"] = all(
            sum(ln["total_minor"] for ln in i["breakdown"]["lines"]) == i["total_minor"] for i in its
        )
    return {
        "verdict": "OK" if checks and all(checks.values()) else "FAIL",
        "checks": checks,
        "run_id": run.get("id"),
        "status": run.get("status"),
        "error": run.get("error"),
        "timings": run.get("timings"),
        "best_total_minor": its[0]["total_minor"] if its else None,
    }


async def _create_dev_run(c: httpx.AsyncClient, case_key: str, trigger: bool, mode: str = "fixture") -> httpx.Response:
    return await c.post(f"{ENGINE}/v1/dev/runs/{case_key}", params={"trigger": str(trigger).lower(), "mode": mode},
                        headers=_engine_headers())


async def _get_run(c: httpx.AsyncClient, run_id: str) -> dict:
    r = await c.get(f"{ENGINE}/v1/runs/{_q(run_id)}", headers=_engine_headers())
    r.raise_for_status()
    return r.json()


@server.tool()
async def engine_health() -> dict:
    """Devuelve /healthz del motor."""
    _guard(ENGINE)
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{ENGINE}/healthz")
        return {"status_code": r.status_code, "body": r.json()}


@server.tool()
async def create_fixture_run(case_key: str = "orlando_nyc_5pax", mode: Mode = "fixture", trigger: bool = False) -> dict:
    """Crea una corrida fixture y devuelve su run_id. Con trigger=False NO dispara n8n."""
    case_key = _case(case_key)
    _guard(ENGINE)
    async with httpx.AsyncClient(timeout=30) as c:
        r = await _create_dev_run(c, case_key, trigger, mode)
        return {"status_code": r.status_code, "body": r.json() if r.status_code < 500 else r.text[:500]}


@server.tool()
async def run_extraction_inprocess(case_key: str = "orlando_nyc_5pax", mode: Mode = "fixture") -> dict:
    """Crea una corrida, ejecuta plan + extract x5 en paralelo (sin n8n) y luego intenta optimize.

    Devuelve ofertas, llamadas externas y cache hits por tipo, y el status HTTP de optimize
    (501 en las Fases 1-2, 200 desde la Fase 3)."""
    case_key = _case(case_key)
    _guard(ENGINE)
    h = _engine_headers()
    async with httpx.AsyncClient(timeout=120) as c:
        r = await _create_dev_run(c, case_key, False, mode)
        r.raise_for_status()
        run_id = r.json()["run_id"]
        rid = _q(run_id)
        (await c.post(f"{ENGINE}/v1/runs/{rid}/plan", headers=h)).raise_for_status()
        res = await asyncio.gather(*(c.post(f"{ENGINE}/v1/runs/{rid}/extract/{k}", headers=h) for k in KINDS))
        opt = await c.post(f"{ENGINE}/v1/runs/{rid}/optimize", headers=h)
    return {
        "run_id": run_id,
        "extract": {k: x.json() if x.status_code == 200 else {"status_code": x.status_code, "body": x.text[:300]}
                    for k, x in zip(KINDS, res)},
        "optimize_status_code": opt.status_code,
    }


@server.tool()
async def wait_for_run(run_id: str, timeout_s: TimeoutS = 90) -> dict:
    """Sondea GET /v1/runs/{run_id} cada segundo hasta done/infeasible/failed o timeout (máx. 300 s)."""
    _guard(ENGINE)
    deadline = time.monotonic() + timeout_s
    async with httpx.AsyncClient(timeout=10) as c:
        while True:
            run = await _get_run(c, run_id)
            if run["status"] in TERMINAL or time.monotonic() > deadline:
                return {k: run.get(k) for k in ("id", "status", "error", "timings")}
            await asyncio.sleep(1)


@server.tool()
async def run_fixture_inprocess(case_key: str = "orlando_nyc_5pax") -> dict:
    """Crea una corrida fixture SIN n8n, la ejecuta completa en el motor y la compara con el golden."""
    case_key = _case(case_key)
    _guard(ENGINE)
    async with httpx.AsyncClient(timeout=120) as c:
        r = await _create_dev_run(c, case_key, False)
        r.raise_for_status()
        run_id = r.json()["run_id"]
        r = await c.post(f"{ENGINE}/v1/runs/{_q(run_id)}/run-all", headers=_engine_headers())
        r.raise_for_status()
        return _verdict(await _get_run(c, run_id), _golden(case_key))


@server.tool()
async def e2e_via_n8n(case_key: str = "orlando_nyc_5pax", timeout_s: TimeoutS = 120) -> dict:
    """Crea una corrida fixture, deja que el motor dispare n8n, espera el final y compara con el golden."""
    case_key = _case(case_key)
    _guard(ENGINE)
    async with httpx.AsyncClient(timeout=30) as c:
        r = await _create_dev_run(c, case_key, True)
        if r.status_code != 202:
            return {"verdict": "FAIL", "step": "create", "status_code": r.status_code, "body": r.text[:500]}
        run_id = r.json()["run_id"]
    await wait_for_run(run_id, timeout_s)
    async with httpx.AsyncClient(timeout=30) as c:
        return _verdict(await _get_run(c, run_id), _golden(case_key))


@server.tool()
async def n8n_fire_webhook(path: str, payload: dict, test_mode: bool = False) -> dict:
    """POST a /webhook/<path> (o /webhook-test/<path> si test_mode) con el header X-Webhook-Secret."""
    _guard(N8N)
    prefix = "webhook-test" if test_mode else "webhook"
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{N8N}/{prefix}/{_q(path)}", json=payload,
            headers={"X-Webhook-Secret": os.environ.get("N8N_WEBHOOK_SECRET", "")},
        )
        return {"status_code": r.status_code, "body": r.text[:1000]}


def _n8n_headers() -> dict:
    return {"X-N8N-API-KEY": os.environ["N8N_API_KEY"], "Accept": "application/json"}


@server.tool()
async def n8n_executions(workflow_id: str | None = None, status: str | None = None, limit: int = 10) -> list[dict]:
    """Lista ejecuciones recientes (status: success|error|running|waiting|canceled)."""
    _guard(N8N)
    params = {"limit": limit, **({"workflowId": workflow_id} if workflow_id else {}), **({"status": status} if status else {})}
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{N8N}/api/v1/executions", params=params, headers=_n8n_headers())
        r.raise_for_status()
        return [
            {k: e.get(k) for k in ("id", "workflowId", "status", "mode", "startedAt", "stoppedAt")}
            for e in r.json().get("data", [])
        ]


@server.tool()
async def n8n_execution(execution_id: str) -> dict:
    """Resumen por nodo de una ejecución: estado, duración (ms), ítems de salida y error."""
    _guard(N8N)
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{N8N}/api/v1/executions/{_q(execution_id)}", params={"includeData": "true"},
                        headers=_n8n_headers())
        r.raise_for_status()
        e = r.json()
    run_data = (((e.get("data") or {}).get("resultData") or {}).get("runData")) or {}
    nodes = {}
    for name, runs in run_data.items():
        last = runs[-1] if runs else {}
        outputs = ((last.get("data") or {}).get("main")) or []
        nodes[name] = {
            "status": last.get("executionStatus"),
            "ms": sum(x.get("executionTime", 0) for x in runs),
            "items_out": [len(o or []) for o in outputs],
            "error": (last.get("error") or {}).get("message"),
        }
    return {"id": e.get("id"), "status": e.get("status"), "startedAt": e.get("startedAt"),
            "stoppedAt": e.get("stoppedAt"), "nodes": nodes}


if __name__ == "__main__":
    server.run("stdio")
