# Fase 0: entorno local y estructura MCP

**Objetivo:** dejar la máquina (Windows 11) lista para el resto de las fases. También dejar estandarizado cómo Claude interactúa con el entorno local, la base de Supabase y los webhooks de n8n.
**Requisito previo:** ninguno. **Habilita:** todas las fases.
**Salida:** Docker, uv, Supabase local y n8n local funcionando; los servidores MCP conectados; permisos y reglas del proyecto activos.

---

## 0.1 Diagnóstico de esta máquina (26/10/2026)

| Herramienta | Detectado | Requerido | Acción |
|---|---|---|---|
| Python | 3.10.0, solo vía `py` (el alias `python` abre la Microsoft Store) | 3.12 gestionado por uv | Instalar uv; uv descarga 3.12 |
| Node.js | v24.22.1 | ≥ 20.9 (Next.js 16) | OK |
| Docker | ❌ no instalado | Docker Desktop (WSL 2) | Instalar |
| uv | ❌ no instalado | uv | Instalar |
| Git | sin verificar | Git | Verificar con `git --version` |

## 0.2 Instalación (PowerShell)

```bash
wsl --install
```
Reiniciar si lo pide. Docker Desktop usa WSL 2.

```bash
winget install --id Docker.DockerDesktop -e
```

```bash
winget install --id astral-sh.uv -e
```

```bash
winget install --id Git.Git -e
```

Cerrar y volver a abrir la terminal (para refrescar el PATH). Después:

```bash
uv python install 3.12
```

Abrir Docker Desktop una vez y aceptar sus términos (lo hace el usuario, no Claude). Opcional: desactivar el alias `python.exe` de la Store en *Configuración → Aplicaciones → Configuración avanzada de aplicaciones → Alias de ejecución de aplicaciones*. En el proyecto siempre se usa `uv run python`.

## 0.3 Esqueleto del repositorio

Crear la carpeta del proyecto e inicializar git:

```bash
git init travelopt
```

Copiar a la raíz los documentos (`master_plan.md`, `fase_*.md`, `estado_del_proyecto.md`) y los archivos de esta fase. El código fuente completo de cada fase está textual en su documento.

**Archivos de la raíz**

**`.gitignore`**

```gitignore
# secretos
.env
.env.*
!.env.example
web/.env*.local

# python
__pycache__/
.venv/
.pytest_cache/
.ruff_cache/

# node / next
node_modules/
web/.next/
web/playwright-report/
web/test-results/

# supabase
supabase/.branches/
supabase/.temp/

# local / despliegue
.claude/settings.local.json
.vercel/
*.pem
```

**`.env.example`**

```bash
# Copiar a .env (NUNCA commitear .env). Generar secretos con:
#   python -c "import secrets; print(secrets.token_urlsafe(32))"

# ---------------- Motor (engine/) ----------------
ENV=local
ENGINE_API_KEY=                      # >= 24 caracteres
ENGINE_BASE_URL=http://localhost:8000
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
DEFAULT_MODE=fixture                 # fixture | hybrid | live
OPENWEATHER_API_KEY=                 # opcional: pronóstico <= 7 días (One Call 3.0)

# ---------------- n8n ----------------
N8N_VERSION=latest                   # reemplazar por la versión exacta instalada
N8N_ENCRYPTION_KEY=                  # respaldarla: sin ella las credenciales de n8n son irrecuperables
N8N_TIMEZONE=UTC
N8N_BASE_URL=http://localhost:5678
N8N_WEBHOOK_URL=http://localhost:5678/webhook/plan-trip
N8N_WEBHOOK_SECRET=
N8N_API_KEY=                         # Settings > n8n API (lo usa travelopt-devtools)
```

Generar los tres secretos (`ENGINE_API_KEY`, `N8N_WEBHOOK_SECRET`, `N8N_ENCRYPTION_KEY`) ejecutando este comando tres veces y pegarlos en `.env`:

```bash
uv run python -c "import secrets; print(secrets.token_urlsafe(32))"
```

> `N8N_ENCRYPTION_KEY` cifra las credenciales de n8n. Guardar una copia fuera del repo (gestor de contraseñas). Si se pierde, hay que recrear todas las credenciales.

## 0.4 Supabase local

La CLI se instala como dependencia de desarrollo en un `package.json` de la raíz. Funciona igual en Windows y en CI.

```bash
npm init -y
```

```bash
npm i -D supabase
```

```bash
npx supabase init
```

Editar `supabase/config.toml`, sección `[auth]`, para habilitar las sesiones anónimas que usa la Fase 4:

```toml
[auth]
enable_anonymous_sign_ins = true
```

```bash
npx supabase start
```

```bash
npx supabase status
```

`status` muestra la API (`http://127.0.0.1:54321`), la DB (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`), Studio (`http://127.0.0.1:54323`) y la **publishable key**, que usa la Fase 4. El MCP local queda en `http://localhost:54321/mcp`.

## 0.5 n8n local

**`docker-compose.yml`**

```yaml
services:
  n8n:
    image: docker.n8n.io/n8nio/n8n:${N8N_VERSION:?definir N8N_VERSION en .env}   # versión exacta, nunca latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:5678:5678"   # solo loopback: n8n no se expone a la red local
    environment:
      N8N_ENCRYPTION_KEY: ${N8N_ENCRYPTION_KEY:?definir N8N_ENCRYPTION_KEY en .env}
      GENERIC_TIMEZONE: ${N8N_TIMEZONE:-UTC}
      TZ: ${N8N_TIMEZONE:-UTC}
      N8N_HOST: localhost
      N8N_PORT: 5678
      N8N_PROTOCOL: http
      WEBHOOK_URL: http://localhost:5678/
      N8N_DIAGNOSTICS_ENABLED: "false"
      N8N_BLOCK_ENV_ACCESS_IN_NODE: "true"      # los nodos no leen $env (engine_base_url es literal en los workflows)
      EXECUTIONS_DATA_PRUNE: "true"
      EXECUTIONS_DATA_MAX_AGE: 168              # horas
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - n8n_data:/home/node/.n8n
      - ./n8n/workflows:/workflows:ro

volumes:
  n8n_data:
```

El compose exige `N8N_VERSION` (versión exacta, nunca `latest`) y `N8N_ENCRYPTION_KEY` definidos en `.env`: si falta alguno, `docker compose` falla con un mensaje explícito. n8n publica el puerto solo en `127.0.0.1`.

```bash
docker compose up -d n8n
```

1. Abrir http://localhost:5678 y crear la cuenta *owner* (la crea el usuario).
2. Anotar la versión (menú de ayuda o `docker compose exec n8n n8n --version`) y fijarla en `.env` (`N8N_VERSION=x.y.z`).
3. *Settings → n8n API* → crear una API key → `N8N_API_KEY` en `.env` (la usa `travelopt-devtools`).
4. Recrear el contenedor con la versión fijada:

```bash
docker compose up -d --force-recreate n8n
```

## 0.6 Estructura MCP (Tarea 2)

### Diseño

El objetivo es que Claude trabaje siempre con **las mismas herramientas, con permisos mínimos y sin ver secretos**.

| Servidor | Para qué lo usa Claude | Dónde se declara | Credenciales |
|---|---|---|---|
| `travelopt-devtools` | Crear corridas, ejecutar extracción o el flujo completo, disparar webhooks de n8n, leer ejecuciones por nodo y comparar con el golden | `.mcp.json` (repo) | Las lee el propio servidor del `.env`; nunca se devuelven al modelo |
| `supabase-local` | Inspeccionar esquema, datos y logs del stack local | `.mcp.json` (repo) | Ninguna (local, sin OAuth) |
| `n8n` (MCP de instancia) | Descubrir y ejecutar workflows publicados | Scope **local** de Claude Code | Token de n8n (fuera del repo) |
| `supabase-staging` | Esquema, logs y advisors de staging (desde la Fase 5) | Scope **local** | OAuth + `read_only=true` |

Reglas (también están en `CLAUDE.md`):
1. **Sin DDL por MCP.** Todo cambio de esquema es una migración en `supabase/migrations/`.
2. **Producción nunca por MCP.**
3. Las pruebas se hacen con `travelopt-devtools`: así son repetibles y comparan contra el golden.

### 0.6.1 `.mcp.json` (del proyecto, sin secretos)

**`.mcp.json`**

```json
{
  "mcpServers": {
    "travelopt-devtools": {
      "type": "stdio",
      "command": "uv",
      "args": ["run", "--project", "tools/devtools_mcp", "python", "tools/devtools_mcp/server.py"]
    },
    "supabase-local": {
      "type": "http",
      "url": "http://localhost:54321/mcp"
    }
  }
}
```

### 0.6.2 Servidor propio `travelopt-devtools`

Python con el SDK `mcp` 2.x (`MCPServer`, transporte stdio). Bloquea hosts no locales salvo `DEVTOOLS_ALLOW_REMOTE=1`. Nunca escribe en stdout fuera del protocolo.

**`tools/devtools_mcp/pyproject.toml`**

```toml
[project]
name = "travelopt-devtools-mcp"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "mcp>=2.3,<3",        # SDK 2.x: FastMCP pasó a llamarse MCPServer
  "httpx>=0.27",
  "python-dotenv>=1.0",
]
```

**`tools/devtools_mcp/server.py`**

```python
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
```

Instalar sus dependencias:

```bash
uv sync --project tools/devtools_mcp
```

| Herramienta | Disponible desde | Uso típico |
|---|---|---|
| `engine_health` | Fase 1 | ¿El motor está arriba y en qué modo? |
| `create_fixture_run` | Fase 1 | Crear una corrida sin disparar n8n (para probar webhooks a mano) |
| `run_extraction_inprocess` | Fase 1 | Plan + 5 extracciones en paralelo; informa el status de `optimize` (501 hasta la Fase 3) |
| `run_fixture_inprocess` | Fase 3 | Flujo completo sin n8n + veredicto contra el golden |
| `e2e_via_n8n` | Fase 2 (completo en la Fase 3) | Flujo real motor → n8n → motor + veredicto |
| `wait_for_run` | Fase 1 | Esperar un estado terminal |
| `n8n_fire_webhook` | Fase 2 | Disparar `plan-trip` con el secreto correcto |
| `n8n_executions` / `n8n_execution` | Fase 2 | Diagnóstico por nodo: estado, ms, ítems y error |

### 0.6.3 Servidores con credenciales: scope local

Se agregan desde una terminal con `claude`. Quedan en la configuración local del usuario y no en el repo.

**n8n (opcional).** Activarlo en *Settings → Instance-level MCP* (requiere owner o admin) y copiar la URL y el token que muestra la UI. En versiones recientes la ruta termina en `/mcp-server/http`.

```bash
claude mcp add --transport http --scope local n8n http://localhost:5678/mcp-server/http --header "Authorization: Bearer <TOKEN_N8N>"
```

**Supabase staging (en la Fase 5, cuando exista el proyecto).** Autenticarse después con `/mcp` desde una sesión interactiva de `claude`.

```bash
claude mcp add --transport http --scope local supabase-staging "https://mcp.supabase.com/mcp?project_ref=<REF_STAGING>&read_only=true&features=database,debugging,docs"
```

### 0.6.4 Permisos de Claude Code

`allow`: comandos de prueba seguros. `ask`: lo que modifica la base, despliega o publica. `deny`: leer archivos de secretos.

**`.claude/settings.json`**

```json
{
  "enabledMcpjsonServers": ["travelopt-devtools", "supabase-local"],
  "permissions": {
    "allow": [
      "mcp__travelopt-devtools",
      "Bash(uv run pytest:*)",
      "Bash(uv run ruff:*)",
      "Bash(uv run python -m app.cli:*)",
      "Bash(uv run python scripts/gate.py:*)",
      "Bash(npx supabase status:*)",
      "Bash(npx supabase test db:*)",
      "Bash(npm run lint:*)",
      "Bash(npm run typecheck:*)",
      "Bash(npm run test:*)",
      "Bash(npm run build:*)",
      "Bash(docker compose ps:*)",
      "Bash(docker compose logs:*)"
    ],
    "ask": [
      "mcp__supabase-local",
      "Bash(npx supabase db reset:*)",
      "Bash(npx supabase db push:*)",
      "Bash(npx supabase link:*)",
      "Bash(vercel:*)",
      "Bash(git push:*)",
      "Edit(.claude/**)"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./engine/.env)",
      "Read(./web/.env.local)",
      "Read(./web/.env.production*)",
      "Read(**/.env)",
      "Read(**/.env.local)",
      "Read(**/.env.*.local)",
      "Read(**/.env.production)",
      "Read(**/.env.development)",
      "Read(**/.env.staging)",
      "Read(**/.env.test)",
      "Read(supabase/.temp/**)",
      "Edit(**/.env)",
      "Edit(**/.env.local)",
      "Edit(**/.env.*.local)",
      "Edit(**/.env.production)",
      "Edit(**/.env.development)",
      "Edit(**/.env.staging)",
      "Edit(**/.env.test)",
      "Edit(supabase/.temp/**)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|PowerShell",
        "hooks": [
          {
            "type": "command",
            "shell": "bash",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/block-env-read.mjs\"",
            "timeout": 10,
            "onFailure": "block",
            "statusMessage": "Revisando acceso a .env"
          }
        ]
      }
    ]
  }
}
```

Las reglas `deny` solo cubren las herramientas de archivos (`Read`/`Edit`). Lo que un comando de shell lea por su cuenta lo frena este hook `PreToolUse`: bloquea cualquier comando de Bash o PowerShell que mencione un archivo `.env`, salvo `.env.example`. Es *fail-closed*: si el hook falla, el comando no se ejecuta. Los pasos que tocan `.env` (pegar claves, copiar desde `.env.example`) los hace el usuario a mano.

**`.claude/hooks/block-env-read.mjs`**

```js
// PreToolUse (Bash / PowerShell): bloquea comandos de shell que mencionen archivos .env.
// Permite .env.example. Es defensa en profundidad: las reglas deny de settings.json solo cubren
// las herramientas de archivos (Read/Edit), no lo que un comando de shell lee por su cuenta.
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const command = String(input?.tool_input?.command ?? "");

// ".env" como nombre de archivo: precedido por inicio, espacio, comilla, separador de ruta, = : ( < , ;
// (así "process.env" o "$env:Path" no cuentan) y seguido opcionalmente de sufijos (.local, .production…).
const pattern = /(?:^|[\s"'`=:(<,;\\/])(\.env[\w.*-]*)/gi;
const hits = [...command.matchAll(pattern)]
  .map((m) => m[1].toLowerCase())
  .filter((name) => !/^\.env\.example$/.test(name));

if (hits.length > 0) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `Bloqueado por .claude/hooks/block-env-read.mjs: el comando referencia ${[...new Set(hits)].join(", ")}. ` +
          "Los archivos .env contienen secretos; usá .env.example como referencia.",
      },
    }),
  );
}
process.exit(0);
```

### 0.6.5 Reglas del proyecto para Claude

**`CLAUDE.md`**

```markdown
# TravelOpt — reglas para Claude

Plataforma de optimización logística y financiera de viajes. Arquitectura y roadmap en `master_plan.md`;
instrucciones por etapa en `fase_N_*.md`.

## Regla de oro: gates de fase
- No empezar la fase N+1 hasta que `uv run python scripts/gate.py N` imprima `GATE FASE N: OK` **y** los checks
  manuales del documento de la fase estén tildados. Si un check falla, se arregla antes de seguir.
- Al terminar una fase, actualizar la tabla "Estado" de `master_plan.md` con fecha y commit.

## Invariantes del dominio (no negociables)
- Dinero: `int` en centavos (`*_minor`). Nunca `float`. Impuestos en basis points, redondeo half-up por línea
  (`engine/app/domain/money.py`). Toda calculadora debe conciliar al centavo con el total del solver.
- Determinismo: misma entrada, misma salida (CP-SAT con `num_workers = 1` y desempates explícitos).
- Restricciones duras (baños, escalas, clima, legalidad) se aplican como filtros con motivo registrado en el
  embudo de factibilidad. No se "relajan" en silencio.
- El caso `orlando_nyc_5pax` es el golden: óptimo USD 20,083.62. Si un cambio lo mueve, es un bug o una
  decisión explícita que actualiza `engine/fixtures/orlando_nyc_5pax/expected.json` en el mismo commit.
- El modelo canónico (`engine/app/domain/models.py`) es el contrato. Los proveedores se adaptan a él.

## Arquitectura en una línea
Next.js (Vercel) -> motor FastAPI `POST /v1/runs` -> n8n (webhook) -> motor `/plan`, `/extract/{kind}` x5 en
paralelo, `/optimize` -> Supabase (único escritor: el motor) -> Realtime -> Next.js.

## Uso de MCP (estándar del proyecto)
- `travelopt-devtools`: herramienta preferida para probar. `run_fixture_inprocess` (sin n8n),
  `e2e_via_n8n` (flujo completo), `n8n_execution` (diagnóstico por nodo). Solo opera contra hosts locales.
- `supabase-local`: inspeccionar esquema y datos locales. **Prohibido** hacer DDL por MCP: todo cambio de
  esquema es un archivo nuevo en `supabase/migrations/` (`npx supabase migration new <nombre>`), probado con
  `npx supabase db reset` + `npx supabase test db`.
- `supabase-staging` (scope local, `read_only=true`): solo lectura y logs. Nunca producción por MCP.
- `n8n` (MCP de instancia, scope local): descubrir/ejecutar workflows expuestos. Los workflows se versionan
  como JSON en `n8n/workflows/`.

## Comandos
- Motor: `cd engine && uv run pytest -q` · `uv run python -m app.cli orlando_nyc_5pax` ·
  `uv run uvicorn app.api.main:app --reload --port 8000`
- Base de datos: `npx supabase start | status | db reset | test db`
- n8n: `docker compose up -d n8n` · UI en http://localhost:5678
- Web: `cd web && npm run dev | lint | typecheck | test | build` · `npx playwright test`

## Secretos
- Nunca leer ni imprimir `.env`, `web/.env.local` ni claves. Usar `.env.example` como referencia.
- Variables con `NEXT_PUBLIC_` son públicas por definición: jamás poner ahí una clave secreta.
- El navegador solo usa la publishable key de Supabase; el motor usa `DATABASE_URL`; n8n solo conoce
  `ENGINE_API_KEY` y el secreto del webhook.
```

## 0.7 Runner de gates

Corre los checks automáticos de cada fase. Los manuales se tildan en el documento de la fase.

**`scripts/gate.py`**

```python
"""Gate de fase: corre los checks automáticos de una fase e imprime OK/FAIL.

    uv run python scripts/gate.py 1

Los checks MANUALES de cada fase están en su documento (fase_N_*.md) y se tildan a mano.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
F1_TESTS = ["tests/test_money.py", "tests/test_query_plan.py", "tests/test_fixture_contracts.py",
            "tests/test_weather_and_http.py", "tests/test_api_extraction.py"]


def no_secrets_in_bundle() -> tuple[bool, str]:
    """Ningún valor de variable server-only de web/.env.local aparece en el bundle del cliente."""
    env, static = ROOT / "web" / ".env.local", ROOT / "web" / ".next" / "static"
    if not env.exists() or not static.exists():
        return False, "falta web/.env.local o web/.next (correr npm run build)"
    secrets = [
        v.strip() for k, _, v in (ln.partition("=") for ln in env.read_text(encoding="utf-8").splitlines())
        if k and not k.startswith(("#", "NEXT_PUBLIC_")) and len(v.strip()) >= 16
    ]
    for f in static.rglob("*.js"):
        text = f.read_text(encoding="utf-8", errors="ignore")
        if any(s in text for s in secrets) or "sb_secret_" in text:
            return False, f"secreto encontrado en {f.relative_to(ROOT)}"
    return True, f"{len(secrets)} secretos verificados"


def workflows_exported() -> tuple[bool, str]:
    names = {p.name for p in (ROOT / "n8n" / "workflows").glob("*.json")}
    need = {"wf01_plan_trip.json", "wf02_error_handler.json", "wf03_maintenance.json"}
    return need <= names, f"presentes: {sorted(names)}"


CHECKS: dict[int, list] = {
    0: [
        ("uv", ["uv", "--version"], "."),
        ("docker engine", ["docker", "info", "--format", "{{.ServerVersion}}"], "."),
        ("supabase local", ["npx", "supabase", "status"], "."),
        ("n8n local", ["docker", "compose", "ps", "--status", "running", "n8n"], "."),
        ("devtools MCP importa", ["uv", "run", "--project", "tools/devtools_mcp", "python", "-c",
                                  "import sys; sys.path.insert(0, 'tools/devtools_mcp'); import server"], "."),
    ],
    1: [
        ("pytest fase 1", ["uv", "run", "pytest", "-q", *F1_TESTS], "engine"),
        ("ruff", ["uv", "run", "ruff", "check", "."], "engine"),
        ("pgTAP RLS", ["npx", "supabase", "test", "db"], "."),
    ],
    2: [
        ("pytest fase 1 (regresión)", ["uv", "run", "pytest", "-q", *F1_TESTS], "engine"),
        ("workflows exportados", workflows_exported, "."),
    ],
    3: [
        ("pytest completo", ["uv", "run", "pytest", "-q"], "engine"),
        ("CLI caso fixture", ["uv", "run", "python", "-m", "app.cli", "orlando_nyc_5pax"], "engine"),
        ("ruff", ["uv", "run", "ruff", "check", "."], "engine"),
    ],
    4: [
        ("lint", ["npm", "run", "lint"], "web"),
        ("typecheck", ["npm", "run", "typecheck"], "web"),
        ("unit (vitest)", ["npm", "run", "test"], "web"),
        ("build", ["npm", "run", "build"], "web"),
        ("sin secretos en bundle", no_secrets_in_bundle, "."),
        ("e2e (playwright)", ["npx", "playwright", "test"], "web"),
    ],
    5: [
        ("pytest completo", ["uv", "run", "pytest", "-q"], "engine"),
        ("build web", ["npm", "run", "build"], "web"),
        ("sin secretos en bundle", no_secrets_in_bundle, "."),
    ],
}


def run(check) -> tuple[bool, str]:
    name, cmd, cwd = check
    if callable(cmd):
        return cmd()
    exe = shutil.which(cmd[0])  # en Windows resuelve npx.cmd / uv.exe
    if exe is None:
        return False, f"no se encontró '{cmd[0]}' en PATH"
    p = subprocess.run([exe, *cmd[1:]], cwd=ROOT / cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    tail = (p.stdout + p.stderr).strip().splitlines()[-1:] or [""]
    return p.returncode == 0, tail[0][:120]


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # consola de Windows
    phase = int(sys.argv[1])
    ok_all = True
    for check in CHECKS[phase]:
        ok, detail = run(check)
        ok_all &= ok
        print(f"[{'OK ' if ok else 'FAIL'}] {check[0]:<28} {detail}")
    print(f"\nGATE FASE {phase}: {'OK' if ok_all else 'FAIL'}  (completar además los checks manuales del documento)")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
```

---

## Checkpoints de validación (todos deben dar OK)

| ID | Check | Cómo | OK si… |
|---|---|---|---|
| CP-0.1 | Docker | `docker info --format "{{.ServerVersion}}"` | Imprime una versión |
| CP-0.2 | uv + Python 3.12 | `uv python list` | Aparece una 3.12 instalada |
| CP-0.3 | Supabase local | `npx supabase status` | API en 54321, DB en 54322, Studio en 54323 y publishable key visible |
| CP-0.4 | Sesiones anónimas | `supabase/config.toml` | `enable_anonymous_sign_ins = true` y `npx supabase stop` + `start` sin errores |
| CP-0.5 | n8n local | Abrir http://localhost:5678 | Login de owner OK y `N8N_VERSION` fijada en `.env` |
| CP-0.6 | API de n8n | Pedir a Claude `n8n_executions` | Responde una lista (vacía); no da 401 |
| CP-0.7 | MCP conectados | `claude mcp list` | `travelopt-devtools` y `supabase-local` figuran como conectados |
| CP-0.8 | Guard del devtools | Pedir a Claude `engine_health` | Error de **conexión** a `localhost:8000` (esperado: el motor nace en la Fase 1), no de configuración |
| CP-0.9 | Deny de secretos | Pedir a Claude "leé el archivo .env" | Claude Code lo bloquea por la regla `deny` |
| CP-0.10 | `.env` fuera de git | `git status --ignored` | `.env` aparece solo como ignorado |
| CP-0.11 | Gate automático | `uv run python scripts/gate.py 0` | `GATE FASE 0: OK` |

> Al cerrar la fase: actualizar la tabla *Estado* de `master_plan.md` y hacer un commit `fase-0: gate OK`.
