"""API del motor (FastAPI). n8n orquesta; el motor extrae, persiste y optimiza.

Máquina de estados de una corrida:
  queued -> extracting -> optimizing -> done | infeasible
  (cualquier estado no terminal) -> failed
"""
from __future__ import annotations

import asyncio
import logging
import re
import secrets
from contextlib import asynccontextmanager
import time
from time import perf_counter
from datetime import date
from collections.abc import Awaitable, Callable, Coroutine
from typing import Annotated, Any, TypeVar
from uuid import UUID

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Path, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from app.domain.legal import LegalRules
from app.domain.models import CASE_KEY_PATTERN, TripRequest
from app.explain.gemini import GeminiExplainer
from app.explain.service import explain as explain_run
from app.optimizer.skeletons import plan_for
from app.providers.fixture import get_fixture
from app.providers.base import Kind
from app.optimizer.price_advice import classify
from app.providers.events import TicketmasterEvents, events_for, prefetch_google_events
from app.providers.places import places_near
from app.providers.routing import MAX_DESTINATIONS, route_table
from app.providers.registry import KINDS, ProviderNotConfigured, build_providers, extract, serpapi_cost
from app.providers.weather import OpenMeteoClimatology, OpenMeteoForecast, history_by_year
from app.repo.base import NON_TERMINAL, RateLimited, Repository, RunLimits, RunRecord
from app.repo.memory import MemoryRepository
from app.services.cache import MemoryCache
from app.services.http import CircuitOpen, RequestStats, UpstreamError
from app.services import alerts
from app.services.alerts import counts as alert_counts
from app.services.alerts import report
from app.services.quota_plan import STEPS, effective_request, narrow, narrowed_steps
from app.services import serpapi as serpapi_svc
from app.services.serpapi import QuotaExhausted, SerpApi
from app.services.ratelimit import SlidingWindow
from app.settings import Mode, get_settings

from app.optimizer import service as _optimizer_service

# Punto de extensión (los tests lo anulan para verificar el 501).
run_optimization: Callable[[Repository, RunRecord], Awaitable[dict]] | None = _optimizer_service.run_optimization

logger = logging.getLogger("travelopt.engine")
logging.getLogger("httpx").setLevel(logging.WARNING)  # httpx loguea URLs completas (con API keys en la query)
MAX_BODY_BYTES = 65_536


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    if s.database_url:
        from app.repo.postgres import PgCache, PgRepository

        pg = await PgRepository(s.database_url).open()
        repo: Repository = pg
        app.state.repo, app.state.cache = pg, PgCache(pg.pool)
    elif s.env == "production":
        raise RuntimeError("DATABASE_URL es obligatorio en producción")
    else:
        repo = MemoryRepository()
        app.state.repo, app.state.cache = repo, MemoryCache()
    # Sin seguir redirecciones: un 3xx de un proveedor no puede desviar la llamada fuera de la lista blanca.
    app.state.http = httpx.AsyncClient(timeout=s.http_timeout_s, follow_redirects=False,
                                       headers={"User-Agent": "travelopt-engine/0.1"})
    alerts.configure(s.alert_webhook_url.get_secret_value() if s.alert_webhook_url else None, app.state.http, s.env)
    app.state.weather_limit = SlidingWindow(s.max_weather_requests_per_user_hour, 3600)
    app.state.client_error_limit = SlidingWindow(s.max_client_errors_per_user_hour, 3600)
    app.state.tasks = set()
    app.state.optimize_slots = asyncio.Semaphore(s.max_concurrent_optimizations)
    if s.orchestrator == "inprocess":
        spawn(app, reaper_loop(repo, s.stale_run_seconds, s.retention_days, s.reap_interval_s))
    yield
    for task in app.state.tasks:
        task.cancel()
    await app.state.http.aclose()
    await repo.close()


# Sin /docs, /redoc ni /openapi.json públicos: el contrato no se expone. En local: GET /v1/dev/openapi.json (con key).
app = FastAPI(title="TravelOpt Engine", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


class BodyLimitMiddleware:
    """ASGI puro: corta cuerpos de más de 64 KiB, declarados (Content-Length) o recibidos (también chunked)."""

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_BODY_BYTES):
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        declared = Headers(scope=scope).get("content-length")
        if declared is not None:
            try:
                too_big = int(declared) > self.max_bytes
            except ValueError:
                await JSONResponse({"detail": {"code": "bad_content_length"}}, status_code=400)(scope, receive, send)
                return
            if too_big:
                await JSONResponse({"detail": {"code": "payload_too_large"}}, status_code=413)(scope, receive, send)
                return

        received, rejected = 0, False

        async def limited_receive():
            nonlocal received, rejected
            msg = await receive()
            if msg["type"] == "http.request" and not rejected:
                received += len(msg.get("body", b""))
                if received > self.max_bytes:
                    rejected = True
                    await JSONResponse({"detail": {"code": "payload_too_large"}}, status_code=413)(scope, receive, send)
            return {"type": "http.disconnect"} if rejected else msg

        async def guarded_send(msg):
            if not rejected:  # tras el 413 se descarta lo que la app intente responder
                await send(msg)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except Exception:
            if not rejected:
                raise


app.add_middleware(BodyLimitMiddleware)


def repo_dep(request: Request) -> Repository:
    return request.app.state.repo


async def require_key(authorization: str | None = Header(default=None)) -> None:
    expected = f"Bearer {get_settings().engine_api_key}"
    # bytes: compare_digest sobre str lanza TypeError (500) si el header trae caracteres no ASCII
    if not authorization or not secrets.compare_digest(authorization.encode(), expected.encode()):
        raise HTTPException(401, {"code": "unauthorized"})


def dev_only() -> None:
    if not get_settings().is_dev:
        raise HTTPException(404)


async def dev_delay(delay_ms: Annotated[int, Query(ge=0, le=10_000)] = 0) -> int:
    """Retardo artificial (máx. 10 s) para el checkpoint de concurrencia; solo en dev."""
    if delay_ms:
        dev_only()
    return delay_ms


async def load_run(run_id: UUID, repo: Repository):
    run = await repo.get_run(str(run_id))
    if run is None:
        raise HTTPException(404, {"code": "run_not_found"})
    return run


# ---------------------------------------------------------------- creación y disparo


class CreateRunIn(BaseModel):
    model_config = ConfigDict(extra="forbid")  # sin asignación masiva: un campo desconocido es un 422

    trip_request: TripRequest
    user_id: UUID | None = None
    mode: Mode | None = None
    trigger: bool = True  # False: no dispara n8n (tests / run-all)


async def _trigger_n8n(request: Request, run_id: str) -> None:
    s = get_settings()
    if not s.n8n_webhook_url:
        raise HTTPException(503, {"code": "orchestrator_not_configured"})
    try:
        r = await request.app.state.http.post(
            s.n8n_webhook_url,
            json={"run_id": run_id},
            headers={"X-Webhook-Secret": s.n8n_webhook_secret or ""},
            timeout=10,
        )
        r.raise_for_status()
    except httpx.HTTPError as exc:
        logger.exception("no se pudo disparar n8n (run_id=%s)", run_id)
        await request.app.state.repo.transition(
            run_id, NON_TERMINAL, "failed", error={"code": "orchestrator_unavailable", "message": type(exc).__name__}
        )
        raise HTTPException(503, {"code": "orchestrator_unavailable"}) from exc


CLIENT_KEY = re.compile(r"^[0-9a-f]{32}$")
LEGAL_RULES_TTL_S = 600


async def current_legal_rules(app: FastAPI, repo: Repository) -> LegalRules:
    """Reglas legales con caché de 10 min. Un fallo cerrado (base inaccesible) no se cachea: el próximo pedido reintenta."""
    cached = getattr(app.state, "legal_rules", None)
    if cached is not None and time.monotonic() - cached[1] < LEGAL_RULES_TTL_S:
        return cached[0]
    rules = await repo.legal_rules()
    if rules.complete:
        app.state.legal_rules = (rules, time.monotonic())
    return rules


async def _create(request: Request, body: CreateRunIn, repo: Repository) -> dict:
    s = get_settings()
    mode = body.mode or s.default_mode
    user_id = str(body.user_id) if body.user_id else None
    # Sin user_id solo crean las rutas dev (bloqueadas en producción) y los tests.
    limits = RunLimits(s.max_active_runs_per_user, s.max_runs_per_user_hour, s.max_active_runs_total,
                       s.max_runs_per_client_hour) if user_id else None
    # Clave seudónima de la conexión (la calcula la web con HMAC; el motor nunca ve la IP). En header y no en el cuerpo:
    # un motor anterior la ignora, así web y motor se pueden desplegar en cualquier orden. Con otro formato, se ignora.
    raw_key = request.headers.get("X-Client-Key", "")
    client_key = raw_key if CLIENT_KEY.fullmatch(raw_key) else None
    try:
        run_id = await repo.create_run(body.trip_request, mode, user_id, limits, client_key)
    except RateLimited as exc:
        raise HTTPException(429, {"code": "rate_limited", "scope": exc.scope, **exc.counts},
                            headers={"Retry-After": "60"}) from exc
    if body.trigger:
        if s.orchestrator == "inprocess":
            spawn(request.app, orchestrate(request, run_id, repo))
        else:
            await _trigger_n8n(request, run_id)
    return {"run_id": run_id, "status": "queued", "mode": mode}


@app.get("/healthz")
async def healthz():
    s = get_settings()
    # Fuera de local solo "ok": entorno, modo y versión no se publican.
    return {"ok": True, "env": s.env, "default_mode": s.default_mode, "version": app.version} if s.is_dev else {"ok": True}


@app.get("/v1/dev/openapi.json", dependencies=[Depends(require_key), Depends(dev_only)], include_in_schema=False)
async def dev_openapi():
    return app.openapi()


@app.post("/v1/runs", status_code=202, dependencies=[Depends(require_key)])
async def create_run(body: CreateRunIn, request: Request, repo: Repository = Depends(repo_dep)):
    return await _create(request, body, repo)


@app.post("/v1/dev/runs/{case_key}", status_code=202, dependencies=[Depends(require_key), Depends(dev_only)])
async def create_fixture_run(case_key: Annotated[str, Path(pattern=CASE_KEY_PATTERN)], request: Request,
                             trigger: bool = True, mode: Mode = "fixture", repo: Repository = Depends(repo_dep)):
    try:
        req = get_fixture(case_key).trip_request()
    except ValueError as exc:  # case_key bien formado pero sin carpeta de fixtures
        raise HTTPException(404, {"code": "case_not_found"}) from exc
    return await _create(request, CreateRunIn(trip_request=req, mode=mode, trigger=trigger), repo)


# ---------------------------------------------------------------- pasos que invoca n8n


@app.post("/v1/runs/{run_id}/plan", dependencies=[Depends(require_key)])
async def plan_run(run_id: UUID, request: Request, repo: Repository = Depends(repo_dep)):
    run = await load_run(run_id, repo)
    steps, cost = await _quota_steps(run.mode, run.request, request)
    plan = plan_for(narrow(run.request, steps))
    counts = {"flights": len(plan.flights), "lodging": len(plan.stays), "activities": len(plan.city_days),
              "weather": len(plan.city_days), "transport": len(plan.cities)}
    summary: dict[str, Any] = {"query_plan": counts}
    if cost is not None:
        summary["serpapi_queries"] = cost  # búsquedas pagas estimadas (las que salen de la caché no cuentan)
    if steps:
        summary["quota_narrowed"] = steps
    if not await repo.transition(str(run_id), {"queued"}, "extracting", summary=summary):
        raise HTTPException(409, {"code": "invalid_state", "status": run.status})
    return {"run_id": str(run_id), "mode": run.mode, "tasks": [{"kind": k, "count": counts[k]} for k in KINDS]}


async def _quota_steps(mode: str, req: TripRequest, request: Request) -> tuple[list[str], int | None]:
    """Recortes mínimos para que la corrida entre en el presupuesto de búsquedas pagas (ver quota_plan.py).
    Sin SerpApi en juego devuelve ([], None): el modo fixture y el golden no cambian."""
    s = get_settings()
    if mode == "fixture" or not s.serpapi_api_key:
        return [], None
    state, steps, cost = request.app.state, [], 0
    for step in (None, *STEPS):
        if step:
            steps.append(step)
        current = narrow(req, steps)
        providers = build_providers(mode, current, s, state.http, state.cache, RequestStats(),
                                    rentals="rentals" not in steps)
        cost = await serpapi_cost(providers, plan_for(current))
        if cost <= s.max_serpapi_queries_per_run:
            break
    return steps, cost  # si no entra ni con todos los recortes, los topes por categoría siguen protegiendo la cuota


# Norma 4 (resiliencia): datos que mejoran el itinerario pero no lo hacen posible. Si fallan o tardan más del plazo,
# la corrida sigue sin ellos y queda marcada como degradada; el optimizador lo registra (nada se relaja en silencio).
NON_CRITICAL_KINDS = frozenset({"weather", "activities"})


T = TypeVar("T")


def _background(coro: Coroutine[Any, Any, T]) -> asyncio.Task[T]:
    """Tarea que sigue aunque quien la espera se rinda (calienta el caché para la próxima consulta)."""
    task = asyncio.ensure_future(coro)
    task.add_done_callback(lambda t: t.cancelled() or t.exception())  # sin "exception was never retrieved"
    return task


async def within_deadline(coro: Coroutine[Any, Any, T], deadline_s: float) -> T:
    return await asyncio.wait_for(asyncio.shield(_background(coro)), deadline_s)


async def _extract_degradable(run_id: str, kind: str, coro: Coroutine[Any, Any, list], repo: Repository,
                              deadline_s: float) -> list:
    try:
        return await within_deadline(coro, deadline_s)
    except TimeoutError:
        reason = "timeout"
    except CircuitOpen:
        reason = "circuit_open"
    except UpstreamError:
        reason = "upstream_error"
    except httpx.HTTPError:
        reason = "http_error"
    logger.warning("extracción degradada (run_id=%s kind=%s reason=%s)", run_id, kind, reason)
    await repo.mark_degraded(run_id, kind, reason)
    return []


@app.post("/v1/runs/{run_id}/extract/{kind}", dependencies=[Depends(require_key)])
async def extract_kind(run_id: UUID, kind: Kind,
                       request: Request, delay_ms: int = Depends(dev_delay), repo: Repository = Depends(repo_dep)):
    run = await load_run(run_id, repo)
    if run.status != "extracting":
        raise HTTPException(409, {"code": "invalid_state", "status": run.status})
    if delay_ms:
        await asyncio.sleep(delay_ms / 1000)  # solo para el checkpoint de concurrencia
    t0 = perf_counter()
    stats = RequestStats()
    req = effective_request(run.request, run.summary)  # con los recortes de cuota decididos en el plan
    plan = plan_for(req)
    try:
        providers = build_providers(run.mode, req, get_settings(), request.app.state.http, request.app.state.cache,
                                    stats, rentals="rentals" not in narrowed_steps(run.summary),
                                    legal=await current_legal_rules(request.app, repo))
        if kind in NON_CRITICAL_KINDS:
            offers = await _extract_degradable(str(run_id), kind, extract(providers, kind, plan), repo,
                                               get_settings().noncritical_deadline_s)
        else:
            offers = await extract(providers, kind, plan)
    except ProviderNotConfigured as exc:
        raise HTTPException(501, {"code": "provider_not_configured", "kind": kind, "message": str(exc)}) from exc
    except QuotaExhausted as exc:  # cuota agotada y nada guardado para esta búsqueda: error controlado, sin inventar
        raise HTTPException(503, {"code": "quota_exhausted", "kind": kind}) from exc
    except UpstreamError as exc:
        raise HTTPException(502, {"code": "upstream_error", "provider": exc.provider, "status": exc.status}) from exc
    finally:
        await repo.log_usage(str(run_id), stats.events)
    if stats.partial_failures:  # algunas búsquedas fallaron sin dato guardado: se sigue con las que respondieron
        await repo.mark_degraded(str(run_id), kind, "partial_upstream")
    elif stats.stale_hits:  # modo histórico: precios reales guardados (vencidos); la cuota o el proveedor no dieron
        await repo.mark_degraded(str(run_id), kind, "quota_historical")
    n = await repo.upsert_offers(str(run_id), kind, offers)
    return {"kind": kind, "offers": n, "api_calls": stats.api_calls, "cache_hits": stats.cache_hits,
            "stale_hits": stats.stale_hits, "partial_failures": stats.partial_failures,
            "elapsed_ms": round((perf_counter() - t0) * 1000, 1)}


@app.post("/v1/runs/{run_id}/optimize", dependencies=[Depends(require_key)])
async def optimize_run(run_id: UUID, repo: Repository = Depends(repo_dep)):
    if run_optimization is None:
        raise HTTPException(501, {"code": "optimizer_not_ready"})
    run = await load_run(run_id, repo)
    if not await repo.transition(str(run_id), {"extracting"}, "optimizing"):
        raise HTTPException(409, {"code": "invalid_state", "status": run.status})
    try:
        return await run_optimization(repo, run)
    except Exception as exc:
        logger.exception("falló el optimizador (run_id=%s)", run_id)
        await repo.transition(str(run_id), NON_TERMINAL, "failed",
                              error={"code": "optimizer_error", "message": type(exc).__name__})
        raise


class FailIn(BaseModel):
    code: str = Field(max_length=64)
    message: str | None = Field(None, max_length=500)
    node: str | None = Field(None, max_length=64)


@app.post("/v1/runs/{run_id}/fail", dependencies=[Depends(require_key)])
async def fail_run(run_id: UUID, body: FailIn, repo: Repository = Depends(repo_dep)):
    await load_run(run_id, repo)
    # El usuario lee `error` por RLS: se guarda solo código y nodo. El mensaje (puede traer respuestas internas o de
    # proveedores) queda en el log del servidor.
    logger.warning("corrida %s falló en n8n: code=%s node=%s message=%s", run_id, body.code, body.node, body.message)
    changed = await repo.transition(str(run_id), NON_TERMINAL, "failed", error={"code": body.code, "node": body.node})
    return {"run_id": str(run_id), "changed": changed}


MAX_WEATHER_WINDOW_DAYS = 31


@app.get("/v1/weather/insights", dependencies=[Depends(require_key)])
async def weather_insights(
    request: Request,
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    start: date,
    end: date,
    uid: UUID,
):
    """Detalle de clima para la UI: el mismo tramo de calendario en cada uno de los últimos 10 años (Open-Meteo,
    archivo) y el pronóstico de los próximos 7 días. Cada parte falla por separado sin tumbar la otra."""
    if not 0 < (end - start).days <= MAX_WEATHER_WINDOW_DAYS:
        raise HTTPException(422, {"code": "invalid_window", "max_days": MAX_WEATHER_WINDOW_DAYS})
    if not request.app.state.weather_limit.allow(str(uid)):
        raise HTTPException(429, {"code": "rate_limited", "scope": "weather"}, headers={"Retry-After": "300"})
    http, cache = request.app.state.http, request.app.state.cache
    clim = OpenMeteoClimatology({"x": (lat, lon)}, http, cache)
    deadline = get_settings().noncritical_deadline_s
    history, forecast = await asyncio.gather(within_deadline(clim.history("x"), deadline),
                                             within_deadline(OpenMeteoForecast(http, cache).daily(lat, lon), deadline),
                                             return_exceptions=True)
    for part in (history, forecast):
        if isinstance(part, BaseException) and not isinstance(part, (UpstreamError, httpx.HTTPError, KeyError,
                                                                     TimeoutError)):
            raise part
    return {
        "years": None if isinstance(history, BaseException) else history_by_year(history, start, end, clim.years),
        "forecast": None if isinstance(forecast, BaseException) else forecast,
        "sources": {"history": "Open-Meteo (archivo histórico)", "forecast": "Open-Meteo (pronóstico)"},
    }


MAX_EVENTS_WINDOW_DAYS = 60


@app.get("/v1/events", dependencies=[Depends(require_key)])
async def city_events(
    request: Request,
    code: Annotated[str, Query(pattern=r"^[A-Z]{2,5}$")],
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    start: date,
    end: date,
    uid: UUID,
):
    """Eventos de la ciudad durante la estadía (Ticketmaster en vivo con caché + Google Events pre-cargado). Comparte
    el límite por usuario del "Ver más" del clima. Nunca gasta cuota de SerpApi: Google Events sale solo de la caché."""
    if not 0 <= (end - start).days <= MAX_EVENTS_WINDOW_DAYS:
        raise HTTPException(422, {"code": "invalid_window", "max_days": MAX_EVENTS_WINDOW_DAYS})
    if not request.app.state.weather_limit.allow(str(uid)):
        raise HTTPException(429, {"code": "rate_limited", "scope": "events"}, headers={"Retry-After": "300"})
    s, http, cache = get_settings(), request.app.state.http, request.app.state.cache
    tm = TicketmasterEvents(s.ticketmaster_api_key, http, cache) if s.ticketmaster_api_key else None
    google_name = _prefetch_cities(s).get(code)  # solo ciudades que pre-carga el cron; si no, Google Events no aplica
    return await events_for(google_name, lat, lon, start, end, cache, tm, s.noncritical_deadline_s)


def _prefetch_cities(s) -> dict[str, str]:
    """PREFETCH_EVENT_CITIES ("ORL:Orlando,NYC:New York") -> {"ORL": "Orlando", "NYC": "New York"}."""
    pairs = (part.split(":", 1) for part in s.prefetch_event_cities.split(",") if ":" in part)
    return {code.strip(): name.strip() for code, name in pairs if code.strip() and name.strip()}


class LatLonIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class RoutesIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    uid: UUID
    origin: LatLonIn
    destinations: list[LatLonIn] = Field(min_length=1, max_length=MAX_DESTINATIONS)


@app.post("/v1/routes", dependencies=[Depends(require_key)])
async def routes(body: RoutesIn, request: Request):
    """Distancia y tiempo en auto por calle desde el alojamiento a cada destino (OSRM, caché permanente). Comparte el
    límite por usuario del "Ver más" del clima; si OSRM no responde, 503 y la web usa su estimación."""
    if not request.app.state.weather_limit.allow(str(body.uid)):
        raise HTTPException(429, {"code": "rate_limited", "scope": "routes"}, headers={"Retry-After": "300"})
    try:
        out = await within_deadline(
            route_table(request.app.state.http, request.app.state.cache, (body.origin.lat, body.origin.lon),
                        [(d.lat, d.lon) for d in body.destinations]),
            get_settings().noncritical_deadline_s)
    except (UpstreamError, httpx.HTTPError, TimeoutError, KeyError) as exc:
        report("routing_unavailable", error=type(exc).__name__)
        raise HTTPException(503, {"code": "routing_unavailable"}) from exc
    return {"routes": out, "source": "OSRM (OpenStreetMap)"}


@app.get("/v1/places", dependencies=[Depends(require_key)])
async def places(
    request: Request,
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    uid: UUID,
):
    """Lugares reales para visitar (Wikidata, caché de 30 días). Información: no entra al optimizador."""
    if not request.app.state.weather_limit.allow(str(uid)):
        raise HTTPException(429, {"code": "rate_limited", "scope": "places"}, headers={"Retry-After": "300"})
    try:
        return await within_deadline(places_near(request.app.state.http, request.app.state.cache, lat, lon),
                                     get_settings().noncritical_deadline_s + 4)  # SPARQL puede tardar unos segundos
    except (UpstreamError, httpx.HTTPError, TimeoutError) as exc:
        report("places_unavailable", error=type(exc).__name__)
        raise HTTPException(503, {"code": "places_unavailable"}) from exc


@app.get("/v1/quota", dependencies=[Depends(require_key)])
async def quota(request: Request):
    """Panel de administración: búsquedas de SerpApi que quedan en el mes (lectura de account.json, sin gastar
    cuota), la reserva configurada y los eventos operativos desde que arrancó el motor."""
    s = get_settings()
    if s.serpapi_api_key:
        await serpapi_svc.METER.refresh(request.app.state.http, s.serpapi_api_key)
    return {"serpapi": {"configured": bool(s.serpapi_api_key), "searches_left": serpapi_svc.METER.left,
                        "reserve": s.serpapi_quota_reserve, "budget_per_run": s.max_serpapi_queries_per_run,
                        "exhausted": serpapi_svc.METER.exhausted(s.serpapi_quota_reserve)},
            "ticketmaster": {"configured": bool(s.ticketmaster_api_key)},
            "alerts": alert_counts()}


@app.post("/v1/maintenance/prefetch-events", dependencies=[Depends(require_key)])
async def prefetch_events(request: Request):
    """Cron semanal (GitHub Actions): guarda Google Events por ciudad. Una búsqueda de SerpApi por ciudad, con el
    medidor y la reserva de cuota; con la cuota en la reserva no gasta y deja lo anterior."""
    s = get_settings()
    if not s.serpapi_api_key:
        raise HTTPException(501, {"code": "provider_not_configured", "kind": "events"})
    names = list(_prefetch_cities(s).values())
    api = SerpApi("serpapi_google_events", s.serpapi_api_key, request.app.state.http, request.app.state.cache,
                  RequestStats(), reserve=s.serpapi_quota_reserve)
    return {"cities": await prefetch_google_events(api, names)}


class ClientErrorIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: UUID
    message: str = Field(min_length=1, max_length=500)
    digest: str | None = Field(None, max_length=64)
    path: str | None = Field(None, max_length=200, pattern=r"^/[A-Za-z0-9/_\-]*$")


@app.post("/v1/client-errors", status_code=204, dependencies=[Depends(require_key)])
async def client_error(body: ClientErrorIn, request: Request, repo: Repository = Depends(repo_dep)):
    """Registra un error de render del navegador (lo reenvía Next con el usuario de la sesión). Con límite por usuario:
    si se excede, se descarta en silencio (204) para que un bucle de errores no inunde la base."""
    if request.app.state.client_error_limit.allow(str(body.user_id)):
        await repo.log_client_error(str(body.user_id), body.message, body.digest, body.path)
    return Response(status_code=204)


class ShareIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    uid: UUID


@app.post("/v1/runs/{run_id}/share", dependencies=[Depends(require_key)])
async def share_run(run_id: UUID, body: ShareIn, repo: Repository = Depends(repo_dep)):
    """Link de solo lectura de una corrida terminada. Solo su dueño lo crea (BOLA: si no es suya, 404 como si no
    existiera). El uid lo pone Next desde la sesión verificada, nunca el navegador."""
    run = await repo.get_run(str(run_id))
    if run is None or run.user_id != str(body.uid):
        raise HTTPException(404, {"code": "run_not_found"})
    if run.status not in ("done", "infeasible"):
        raise HTTPException(409, {"code": "invalid_state", "status": run.status})
    return {"token": await repo.create_share(str(run_id), str(body.uid))}


@app.get("/v1/runs/{run_id}/explanation", dependencies=[Depends(require_key)])
async def run_explanation(run_id: UUID, uid: UUID, request: Request, repo: Repository = Depends(repo_dep)):
    """Por qué una búsqueda no tiene resultados, en palabras (solo su dueño). Siempre responde 200 con un texto: si el
    LLM no está configurado o falla, la explicación por reglas; nunca un error hacia la persona."""
    run = await repo.get_run(str(run_id))
    if run is None or run.user_id != str(uid):
        raise HTTPException(404, {"code": "run_not_found"})
    if run.status != "infeasible":
        raise HTTPException(409, {"code": "invalid_state", "status": run.status})
    s = get_settings()
    explainer = GeminiExplainer(s.gemini_api_key.get_secret_value(), s.gemini_model, request.app.state.http,
                                s.explain_timeout_s) if s.gemini_api_key else None
    out = await explain_run(str(run.id), effective_request(run.request, run.summary), run.summary or {},
                            lambda: repo.load_offers(run.id), request.app.state.cache,
                            request.app.state.optimize_slots, explainer, await current_legal_rules(request.app, repo))
    return out.model_dump(mode="json")


@app.get("/v1/runs/{run_id}/price-advice", dependencies=[Depends(require_key)])
async def price_advice(run_id: UUID, uid: UUID, repo: Repository = Depends(repo_dep)):
    """Asesor de momento óptimo por vuelo real de la corrida (solo su dueño). Una consulta por ruta y fecha, en
    paralelo; las estadísticas las calcula Postgres. Sin historial suficiente (cold start), el vuelo no aparece."""
    run = await repo.get_run(str(run_id))
    if run is None or run.user_id != str(uid):
        raise HTTPException(404, {"code": "run_not_found"})
    flights = [f for f in (await repo.load_offers(run.id)).flights if f.provider not in ("fixture", "simulado")]
    routes = sorted({(f.origin, f.destination, f.depart_at.date().isoformat()) for f in flights})[:40]
    stats = dict(zip(routes, await asyncio.gather(*(repo.flight_price_stats(*r) for r in routes))))
    out = {}
    for f in flights:
        st = stats.get((f.origin, f.destination, f.depart_at.date().isoformat()))
        advice = classify(f.price_per_pax_minor, st)
        if advice and st:
            out[f.id] = {"advice": advice, "median_minor": round(st.median or 0), "snapshots": st.snapshots}
    return {"advice": out}


@app.get("/v1/shares/{token}", dependencies=[Depends(require_key)])
async def get_shared(token: UUID, repo: Repository = Depends(repo_dep)):
    """Vista de solo lectura: el pedido (sin presupuesto) y los itinerarios; ningún dato de quien lo compartió."""
    run_id = await repo.get_share(str(token))
    run = await repo.get_run(run_id) if run_id else None
    if run is None:
        raise HTTPException(404, {"code": "share_not_found"})
    request = run.request.model_dump(mode="json", exclude={"budget_minor", "case_key"})
    return {"status": run.status, "request": request, "itineraries": await repo.get_itineraries(run.id)}


@app.get("/v1/runs/{run_id}", dependencies=[Depends(require_key)])
async def get_run(run_id: UUID, repo: Repository = Depends(repo_dep)):
    run = await load_run(run_id, repo)
    return {"id": run.id, "status": run.status, "mode": run.mode, "summary": run.summary,
            "error": run.error, "timings": run.timings, "itineraries": await repo.get_itineraries(run.id)}


@app.post("/v1/runs/{run_id}/run-all", dependencies=[Depends(require_key), Depends(dev_only)])
async def run_all(run_id: UUID, request: Request, repo: Repository = Depends(repo_dep)):
    """Ejecuta plan -> extract x5 (concurrente) -> optimize en proceso, sin n8n (depuración)."""
    await plan_run(run_id, request, repo)
    await asyncio.gather(*(extract_kind(run_id, k, request, 0, repo) for k in KINDS))
    return await optimize_run(run_id, repo)


# ---------------------------------------------------------------- orquestación en proceso (producción sin n8n)
# Mismo flujo y manejo de fallas que WF-01/WF-02/WF-03: plan -> 5 extracciones en paralelo -> optimizar; si falla un
# paso crítico la corrida queda `failed` con código y paso (lo que lee el usuario); el reaper cierra las colgadas.


def spawn(app: FastAPI, coro: Coroutine[Any, Any, None]) -> asyncio.Task[None]:
    """Tarea de fondo con referencia fuerte (asyncio solo guarda referencias débiles) y cancelada al apagar."""
    task = asyncio.ensure_future(coro)
    app.state.tasks.add(task)
    task.add_done_callback(app.state.tasks.discard)
    return task


async def _fail(repo: Repository, run_id: str, code: str, node: str) -> None:
    await repo.transition(run_id, NON_TERMINAL, "failed", error={"code": code, "node": node})


async def orchestrate(request: Request, run_id: str, repo: Repository) -> None:
    rid = UUID(run_id)
    try:
        await plan_run(rid, request, repo)
        results = await asyncio.gather(*(extract_kind(rid, k, request, 0, repo) for k in KINDS), return_exceptions=True)
        failed = [k for k, r in zip(KINDS, results) if isinstance(r, BaseException)]
        for k, r in zip(KINDS, results):
            if isinstance(r, BaseException):
                logger.error("extracción crítica fallida (run_id=%s kind=%s): %r", run_id, k, r)
        if failed:  # los no críticos ya se degradaron dentro de extract_kind: acá solo llegan vuelos, alojamiento, traslados
            report("run_extraction_failed", "error", kinds=",".join(failed))
            quota = any(isinstance(r, HTTPException) and isinstance(r.detail, dict)
                        and r.detail.get("code") == "quota_exhausted" for r in results)
            return await _fail(repo, run_id, "quota_exhausted" if quota else "extraction_failed", ",".join(failed))
        async with request.app.state.optimize_slots:
            await optimize_run(rid, repo)  # si el optimizador falla, él mismo marca la corrida y relanza
    except HTTPException as exc:
        logger.warning("orquestación cortada (run_id=%s): %s", run_id, exc.detail)
        await _fail(repo, run_id, "orchestration_error", "inprocess")
    except Exception:  # borde de una tarea de fondo: nadie la espera; se registra y la corrida queda `failed`
        logger.exception("falló la orquestación en proceso (run_id=%s)", run_id)
        await _fail(repo, run_id, "orchestration_error", "inprocess")


async def maintenance(repo: Repository, stale_s: int, retention_days: int) -> dict:
    """Cierra las corridas colgadas y aplica la retención de datos. La usan el reaper en proceso y WF-03."""
    reaped = await repo.reap_stale(stale_s)
    purged = await repo.purge_older_than(retention_days)
    if reaped or purged:
        logger.warning("mantenimiento: %d corridas colgadas cerradas, %d búsquedas vencidas borradas", reaped, purged)
    return {"reaped": reaped, "purged": purged}


async def reaper_loop(repo: Repository, stale_s: int, retention_days: int, every_s: int) -> None:
    """Reemplaza a WF-03: al arrancar (p. ej. tras despertar en el plan gratuito) y periódicamente."""
    while True:
        try:
            await maintenance(repo, stale_s, retention_days)
        except Exception:  # un error de base no debe matar el bucle; se registra y se reintenta en el próximo ciclo
            logger.exception("mantenimiento: falló la limpieza")
        await asyncio.sleep(every_s)


@app.post("/v1/maintenance/reap", dependencies=[Depends(require_key)])
async def reap(repo: Repository = Depends(repo_dep)):
    s = get_settings()
    return await maintenance(repo, s.stale_run_seconds, s.retention_days)
