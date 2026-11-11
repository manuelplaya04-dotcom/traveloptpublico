import asyncio

import httpx
import pytest

from app.optimizer.skeletons import build_query_plan, generate_skeletons
from app.providers.base import collect_offers
from app.providers.fixture import FixtureProvider
from app.repo.memory import MemoryRepository
from app.services.cache import MemoryCache
from app.settings import get_settings

CASE = "orlando_nyc_5pax"
API_KEY = "test-key-0123456789abcdefghij"


@pytest.fixture(scope="session")
def provider():
    return FixtureProvider(CASE)


@pytest.fixture(scope="session")
def req(provider):
    return provider.trip_request()


@pytest.fixture(scope="session")
def plan(req):
    return build_query_plan(req, generate_skeletons(req))


@pytest.fixture(scope="session")
def offers(provider, plan):
    return asyncio.run(collect_offers(plan, provider))


@pytest.fixture
def api(monkeypatch):
    """Cliente HTTP contra la app FastAPI en proceso, con repositorio en memoria."""
    monkeypatch.setenv("ENGINE_API_KEY", API_KEY)
    monkeypatch.setenv("ENV", "local")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    get_settings.cache_clear()
    from app.api.main import app

    app.state.repo, app.state.cache = MemoryRepository(), MemoryCache()
    app.state.http = httpx.AsyncClient()
    from app.services.ratelimit import SlidingWindow

    app.state.weather_limit = SlidingWindow(get_settings().max_weather_requests_per_user_hour, 3600)
    app.state.client_error_limit = SlidingWindow(get_settings().max_client_errors_per_user_hour, 3600)
    app.state.tasks = set()
    app.state.optimize_slots = asyncio.Semaphore(2)
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://engine",
        headers={"Authorization": f"Bearer {API_KEY}"}, timeout=30,
    )


async def new_fixture_run(api) -> str:
    r = await api.post(f"/v1/dev/runs/{CASE}", params={"trigger": "false"})
    assert r.status_code == 202, r.text
    return r.json()["run_id"]


@pytest.fixture(autouse=True)
def _quota_meter_offline(monkeypatch):
    """Sin lecturas de account.json en los tests: cada test arranca con un medidor nuevo y la cuota desconocida.
    Los tests del medidor arman el suyo."""
    from app.services import serpapi

    monkeypatch.setattr(serpapi, "METER", serpapi.QuotaMeter(refresh_s=float("inf"), clock=lambda: 0.0))
    serpapi.METER.read_at = 0.0


@pytest.fixture(autouse=True)
def _fresh_serpapi_limiter(monkeypatch):
    """El balde real de SerpApi (50/hora) es global: sin reiniciarlo, los reintentos de un test agotarían la ráfaga y
    el siguiente esperaría minutos. Cada test arranca con uno lleno (mismo objeto para vuelos y hoteles)."""
    from app.services import http

    bucket = http.TokenBucket(rate_per_s=50 / 3600, burst=20)
    for name in ("serpapi_google_flights", "serpapi_google_hotels", "serpapi_google_events"):
        monkeypatch.setitem(http.LIMITERS, name, bucket)
    monkeypatch.setitem(http.LIMITERS, "osrm_public", http.TokenBucket(rate_per_s=1, burst=10))
    monkeypatch.setitem(http.LIMITERS, "wikidata_sparql", http.TokenBucket(rate_per_s=1, burst=20))
