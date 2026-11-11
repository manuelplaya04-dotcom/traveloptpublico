"""Norma 4: circuit breaker, plazo para datos no críticos y degradación elegante con motivo registrado."""
import asyncio

import httpx
import pytest

import app.api.main as main
from app.domain.models import OfferSet
from app.optimizer.solver import optimize
from app.providers.base import collect_offers
from app.optimizer.skeletons import plan_for
from app.services.http import CircuitBreaker, CircuitOpen, UpstreamError, breaker_for, fetch_json, BREAKERS
from app.settings import get_settings
from tests.conftest import new_fixture_run

GOLDEN_MINOR = 2008362


# ---------------------------------------------------------------- circuit breaker


def test_breaker_opens_after_threshold_and_half_opens_after_cooldown():
    t = [0.0]
    b = CircuitBreaker(threshold=2, cooldown_s=30, clock=lambda: t[0])
    b.failure()
    b.check("p")  # 1 falla: sigue cerrado
    b.failure()
    with pytest.raises(CircuitOpen):
        b.check("p")
    t[0] = 31
    b.check("p")  # semiabierto: deja pasar una prueba
    b.failure()  # la prueba falla: vuelve a abrir enseguida
    with pytest.raises(CircuitOpen):
        b.check("p")
    t[0] = 62
    b.check("p")
    b.success()
    assert b.failures == 0 and b.opened_at is None


def test_fetch_json_stops_calling_while_open():
    calls = []
    BREAKERS.pop("cb_test", None)

    async def go():
        client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: calls.append(r) or httpx.Response(503)))
        for _ in range(5):  # cada llamada agota sus reintentos = 1 falla del proveedor
            with pytest.raises(UpstreamError):
                await fetch_json(client, "GET", "https://api.open-meteo.com/x", provider="cb_test",
                                 max_attempts=1)
        n = len(calls)
        with pytest.raises(CircuitOpen):
            await fetch_json(client, "GET", "https://api.open-meteo.com/x", provider="cb_test")
        assert len(calls) == n  # abierto: no se llamó

    asyncio.run(go())
    assert breaker_for("cb_test").opened_at is not None
    BREAKERS.pop("cb_test")


def test_client_errors_do_not_open_the_circuit():
    BREAKERS.pop("cb_4xx", None)

    async def go():
        client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(401)))
        for _ in range(8):
            with pytest.raises(UpstreamError) as e:
                await fetch_json(client, "GET", "https://api.open-meteo.com/x", provider="cb_4xx")
            assert not isinstance(e.value, CircuitOpen)

    asyncio.run(go())
    BREAKERS.pop("cb_4xx")


# ---------------------------------------------------------------- degradación en la API


def _failing_extract(kinds: set[str], exc: BaseException | None = None, sleep_s: float = 0):
    real = main.extract

    async def fake(providers, kind, plan):
        if kind in kinds:
            if sleep_s:
                await asyncio.sleep(sleep_s)
            raise exc or UpstreamError("simulado", 503, "caído")
        return await real(providers, kind, plan)

    return fake


async def _run_through_api(api) -> dict:
    rid = await new_fixture_run(api)
    assert (await api.post(f"/v1/runs/{rid}/plan")).status_code == 200
    for kind in ("flights", "lodging", "activities", "weather", "transport"):
        r = await api.post(f"/v1/runs/{rid}/extract/{kind}")
        assert r.status_code == 200, (kind, r.text)  # ninguna falla no crítica corta el flujo
    assert (await api.post(f"/v1/runs/{rid}/optimize")).status_code == 200
    return (await api.get(f"/v1/runs/{rid}")).json()


def _activities(run: dict) -> list[dict]:
    return [a for st in run["itineraries"][0]["stays"] for a in st["activities"]]


def test_weather_down_keeps_outdoor_activities_unverified(api, monkeypatch):
    monkeypatch.setattr(main, "extract", _failing_extract({"weather"}))
    run = asyncio.run(_run_through_api(api))
    assert run["status"] == "done"
    assert run["summary"]["degraded"] == {"weather": "upstream_error"}
    assert "clima_no_disponible" in run["summary"]["diagnostics"]["warnings"]
    acts = _activities(run)
    assert any(a["outdoor"] and a["weather_verified"] is False for a in acts)
    assert all(a["weather_verified"] for a in acts if not a["outdoor"])


def test_activities_down_returns_itinerary_without_them(api, monkeypatch):
    monkeypatch.setattr(main, "extract", _failing_extract({"activities"}, CircuitOpen("simulado")))
    run = asyncio.run(_run_through_api(api))
    assert run["status"] == "done"
    assert run["summary"]["degraded"] == {"activities": "circuit_open"}
    assert "actividades_no_disponibles" in run["summary"]["diagnostics"]["warnings"]
    assert _activities(run) == []
    flights_and_lodging = run["itineraries"][0]
    assert flights_and_lodging["flights"] and all(st["lodging"] for st in flights_and_lodging["stays"])


def test_slow_non_critical_provider_hits_the_deadline(api, monkeypatch):
    monkeypatch.setenv("NONCRITICAL_DEADLINE_S", "0.2")
    get_settings.cache_clear()
    monkeypatch.setattr(main, "extract", _failing_extract({"weather"}, sleep_s=5))
    run = asyncio.run(_run_through_api(api))
    assert run["status"] == "done" and run["summary"]["degraded"] == {"weather": "timeout"}


def test_critical_failure_still_fails_the_extraction(api, monkeypatch):
    monkeypatch.setattr(main, "extract", _failing_extract({"flights"}))

    async def go():
        rid = await new_fixture_run(api)
        await api.post(f"/v1/runs/{rid}/plan")
        return await api.post(f"/v1/runs/{rid}/extract/flights")

    r = asyncio.run(go())
    assert r.status_code == 502 and r.json()["detail"]["code"] == "upstream_error"


def test_no_degradation_keeps_the_golden(provider, req):
    offers = asyncio.run(collect_offers(plan_for(req), provider))
    res = optimize(req, offers)
    assert res.itineraries[0].total_minor == GOLDEN_MINOR
    assert "clima_no_disponible" not in res.diagnostics["warnings"]


def test_degraded_weather_in_optimizer_is_explicit(provider, req):
    offers = asyncio.run(collect_offers(plan_for(req), provider))
    no_weather = OfferSet(**{**offers.model_dump(), "weather": []})
    res = optimize(req, no_weather, degraded=frozenset({"weather"}))
    w = res.diagnostics["warnings"]
    assert "clima_no_disponible" in w and any(x.startswith("sin_clima:") for x in w)
    assert res.itineraries  # sigue habiendo itinerario
