"""Clima y cliente HTTP sin red: respuestas simuladas con httpx.MockTransport."""
import asyncio
from datetime import date, timedelta

import httpx
import pytest

from app.providers.weather import CompositeWeather, OpenMeteoClimatology, climatology
from app.services.cache import MemoryCache
from app.services.http import RequestStats, UpstreamError, fetch_json, limiter_for


def _fake_archive(start: date, end: date):
    days, tmax, precip = [], [], []
    d = start
    while d <= end:
        days.append(d.isoformat())
        tmax.append(33.0)
        precip.append(25.0 if d.day % 5 == 0 else 0.0)  # 1 de cada 5 días: lluvia fuerte
        d += timedelta(days=1)
    return {"daily": {"time": days, "temperature_2m_max": tmax, "precipitation_sum": precip}}


def test_climatology_window_math():
    hist = {date(2020, 7, 1) + timedelta(days=i): (30.0 + i % 2, 12.0 if i % 2 else 0.0) for i in range(30)}
    w = climatology("ORL", date(2027, 7, 10), hist, range(2020, 2021), 3, 10.0, "t")
    assert w.heavy_rain_prob == round(3 / 7, 3)  # 7 muestras (10/7 ±3), 3 húmedas
    assert w.source == "t:2020-2020"


def test_open_meteo_one_call_per_city_and_cached():
    calls = []

    def handler(request: httpx.Request):
        calls.append(request.url.params["latitude"])
        p = request.url.params
        return httpx.Response(200, json=_fake_archive(date.fromisoformat(p["start_date"]), date.fromisoformat(p["end_date"])))

    async def go():
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        cache, stats = MemoryCache(), RequestStats()
        prov = OpenMeteoClimatology({"ORL": (28.3852, -81.5639)}, client, cache, stats, today=date(2026, 10, 26))
        days = [("ORL", date(2027, 7, 8) + timedelta(days=i)) for i in range(10)]
        first = await prov.weather(days)
        second = await prov.weather(days)
        assert len(first) == 10 and first == second
        assert len(calls) == 1 and stats.cache_hits == 1  # 10 años en UNA llamada; 2da vez desde caché
        assert all(0.1 < w.heavy_rain_prob < 0.3 for w in first)
        assert first[0].source == "open_meteo_climatology:2016-2025"

    asyncio.run(go())


def test_composite_uses_climatology_beyond_horizon():
    class Clim:
        async def weather(self, cd):
            return [("clim", c, d) for c, d in cd]

    class Fc:
        async def weather(self, cd):
            return []

    async def go():
        out = await CompositeWeather(Clim(), Fc(), today=date(2026, 10, 26)).weather([("ORL", date(2027, 7, 8))])
        assert out == [("clim", "ORL", date(2027, 7, 8))]

    asyncio.run(go())


def test_retry_on_429_then_success():
    state = {"n": 0}

    def handler(request):
        state["n"] += 1
        if state["n"] < 3:
            return httpx.Response(429, headers={"Retry-After": "0"})
        return httpx.Response(200, json={"ok": True})

    async def go():
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        limiter_for("t429").rate = 1000
        stats = RequestStats()
        out = await fetch_json(client, "GET", "https://api.open-meteo.com/a", provider="t429", stats=stats, base_delay_s=0.01)
        assert out == {"ok": True} and state["n"] == 3 and stats.api_calls == 3

    asyncio.run(go())


def test_non_retryable_raises_immediately():
    async def go():
        client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(401, text="bad key")))
        with pytest.raises(UpstreamError) as e:
            await fetch_json(client, "GET", "https://api.open-meteo.com/b", provider="t401")
        assert e.value.status == 401

    asyncio.run(go())
