"""Orquestación en proceso (producción sin n8n): mismo flujo, mismos resultados y mismo manejo de fallas que WF-01/02/03."""
import asyncio

import pytest

import app.api.main as main
from app.services.http import UpstreamError
from app.settings import get_settings
from tests.test_resilience import GOLDEN_MINOR, _failing_extract

TERMINAL = {"done", "infeasible", "failed"}


@pytest.fixture
def inprocess(monkeypatch):
    monkeypatch.setenv("ORCHESTRATOR", "inprocess")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _trip() -> dict:
    from app.providers.fixture import FixtureProvider

    return FixtureProvider("orlando_nyc_5pax").trip_request().model_dump(mode="json")


async def _create_and_wait(api, timeout_s: float = 60) -> dict:
    r = await api.post("/v1/runs", json={"trip_request": _trip(), "user_id": "00000000-0000-4000-8000-0000000000aa"})
    assert r.status_code == 202, r.text
    rid = r.json()["run_id"]
    for _ in range(int(timeout_s * 10)):
        run = (await api.get(f"/v1/runs/{rid}")).json()
        if run["status"] in TERMINAL:
            return run
        await asyncio.sleep(0.1)
    raise AssertionError(f"la corrida no terminó: {run['status']}")


def test_create_run_orchestrates_without_n8n_and_reaches_the_golden(api, inprocess):
    run = asyncio.run(_create_and_wait(api))
    assert run["status"] == "done", run
    assert run["itineraries"][0]["total_minor"] == GOLDEN_MINOR
    assert set(run["timings"]) >= {"queued", "extracting", "optimizing", "done"}


def test_critical_extraction_failure_marks_the_run_failed_with_its_step(api, inprocess, monkeypatch):
    monkeypatch.setattr(main, "extract", _failing_extract({"flights"}))
    run = asyncio.run(_create_and_wait(api))
    assert run["status"] == "failed"
    assert run["error"] == {"code": "extraction_failed", "node": "flights"}


def test_non_critical_failure_still_finishes_degraded(api, inprocess, monkeypatch):
    monkeypatch.setattr(main, "extract", _failing_extract({"weather"}, UpstreamError("simulado", 503, "caído")))
    run = asyncio.run(_create_and_wait(api))
    assert run["status"] == "done" and run["summary"]["degraded"] == {"weather": "upstream_error"}


def test_quota_exhausted_without_history_fails_with_a_controlled_code(api, inprocess, monkeypatch):
    from app.services.serpapi import QuotaExhausted

    monkeypatch.setattr(main, "extract", _failing_extract({"lodging"}, QuotaExhausted("serpapi_google_hotels")))
    run = asyncio.run(_create_and_wait(api))
    assert run["status"] == "failed" and run["error"] == {"code": "quota_exhausted", "node": "lodging"}


def test_historical_prices_flag_the_run_without_changing_the_result(api, inprocess, monkeypatch):
    from app.services.http import RequestStats

    class HistoricalStats(RequestStats):  # como si cada extracción hubiera servido datos guardados (cuota agotada)
        def __init__(self):
            super().__init__(stale_hits=1)

    monkeypatch.setattr(main, "RequestStats", HistoricalStats)
    run = asyncio.run(_create_and_wait(api))
    assert run["status"] == "done" and run["itineraries"][0]["total_minor"] == GOLDEN_MINOR
    assert run["summary"]["degraded"]["flights"] == "quota_historical"


def test_n8n_mode_is_still_the_default(api, monkeypatch):
    monkeypatch.setenv("N8N_WEBHOOK_URL", "")  # el entorno local puede tenerla configurada
    get_settings.cache_clear()
    assert get_settings().orchestrator == "n8n"

    async def go():  # sin webhook configurado, el modo n8n responde 503 como antes
        return await api.post("/v1/runs", json={"trip_request": _trip()})

    r = asyncio.run(go())
    assert r.status_code == 503 and r.json()["detail"]["code"] == "orchestrator_not_configured"


def test_reaper_loop_reaps_on_start_and_survives_db_errors():
    calls = []

    class Repo:
        async def reap_stale(self, older_than_s):
            calls.append(older_than_s)
            if len(calls) == 1:
                raise ConnectionError("base caída")
            return 1

        async def purge_older_than(self, days):
            return 0

    async def go():
        task = asyncio.ensure_future(main.reaper_loop(Repo(), 600, 30, 0.01))
        await asyncio.sleep(0.05)
        task.cancel()

    asyncio.run(go())
    assert len(calls) >= 2 and calls[0] == 600  # el error de la primera vuelta no cortó el bucle
