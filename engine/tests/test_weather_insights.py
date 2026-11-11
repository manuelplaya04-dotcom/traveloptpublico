"""Detalle de clima para la UI: histórico año por año + pronóstico (Open-Meteo simulado, sin red)."""
import asyncio
from datetime import date, timedelta

import app.providers.weather as weather
from app.services.http import UpstreamError

URL = "/v1/weather/insights"
Q = {"lat": 28.3852, "lon": -81.5639, "start": "2027-07-08", "end": "2027-07-16",
     "uid": "00000000-0000-4000-8000-000000000001"}


def _archive(params):
    start, end = date.fromisoformat(params["start_date"]), date.fromisoformat(params["end_date"])
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    # julio: 30 °C, y el día 10 de cada año llueve 12 mm (lluvia fuerte >= 10 mm)
    return {"daily": {"time": [d.isoformat() for d in days],
                      "temperature_2m_max": [30.0 + (d.month == 7) * d.day / 10 for d in days],
                      "precipitation_sum": [12.0 if (d.month, d.day) == (7, 10) else 1.0 for d in days]}}


def _forecast(params):
    days = [date(2026, 10, 28) + timedelta(days=i) for i in range(params["forecast_days"])]
    return {"daily": {"time": [d.isoformat() for d in days], "temperature_2m_max": [25.0] * len(days),
                      "temperature_2m_min": [18.0] * len(days), "precipitation_sum": [0.0] * len(days),
                      "precipitation_probability_max": [10] * len(days)}}


def _fake(fail: str | None = None):
    async def fetch_json(client, method, url, *, provider, stats=None, params=None, **kw):
        if fail and fail in url:
            raise UpstreamError(provider, 503, "simulado")
        return _archive(params) if "archive" in url else _forecast(params)
    return fetch_json


def test_history_by_year_and_forecast(api, monkeypatch):
    monkeypatch.setattr(weather, "fetch_json", _fake())
    r = asyncio.run(api.get(URL, params=Q))
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["years"]) == 10
    y = body["years"][-1]
    assert y["days"] == 8 and y["heavy_rain_days"] == 1  # 8 noches, el 10/7 llueve fuerte
    assert y["tmax_avg_c"] == round(sum(30 + d / 10 for d in range(8, 16)) / 8, 1)
    assert y["tmax_max_c"] == 31.5
    assert len(body["forecast"]) == 7 and body["forecast"][0]["tmin_c"] == 18.0


def test_one_provider_down_does_not_break_the_other(api, monkeypatch):
    monkeypatch.setattr(weather, "fetch_json", _fake(fail="forecast"))
    body = asyncio.run(api.get(URL, params=Q)).json()
    assert body["forecast"] is None and len(body["years"]) == 10


def test_rejects_bad_input_and_requires_key(api, monkeypatch):
    monkeypatch.setattr(weather, "fetch_json", _fake())

    async def go():
        assert (await api.get(URL, params={**Q, "end": "2027-09-30"})).status_code == 422  # ventana > 31 días
        assert (await api.get(URL, params={**Q, "end": Q["start"]})).status_code == 422  # ventana vacía
        assert (await api.get(URL, params={**Q, "lat": 95})).status_code == 422
        assert (await api.get(URL, params={k: v for k, v in Q.items() if k != "uid"})).status_code == 422
        assert (await api.get(URL, params=Q, headers={"Authorization": "Bearer nope"})).status_code == 401

    asyncio.run(go())


def test_rate_limited_per_user(api, monkeypatch):
    from app.api.main import app
    from app.services.ratelimit import SlidingWindow

    monkeypatch.setattr(weather, "fetch_json", _fake())
    app.state.weather_limit = SlidingWindow(2, 3600)
    other = {**Q, "uid": "00000000-0000-4000-8000-000000000002"}

    async def go():
        assert [(await api.get(URL, params=Q)).status_code for _ in range(3)] == [200, 200, 429]
        r = await api.get(URL, params=Q)
        assert r.json()["detail"] == {"code": "rate_limited", "scope": "weather"} and r.headers["Retry-After"] == "300"
        assert (await api.get(URL, params=other)).status_code == 200  # el límite es por usuario

    asyncio.run(go())


def test_sliding_window_expires_and_purges():
    from app.services.ratelimit import SlidingWindow

    t = [0.0]
    w = SlidingWindow(1, 10, clock=lambda: t[0])
    assert w.allow("a") and not w.allow("a")
    t[0] = 10.5
    assert w.allow("a")
    w.MAX_KEYS = 2
    w.allow("b")
    t[0] = 30
    w.allow("c")  # al llegar al tope se purgan las claves inactivas
    assert set(w.hits) == {"c"}
