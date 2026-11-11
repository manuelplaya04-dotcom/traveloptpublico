"""Traslados por calle (OSRM) con caché permanente, sin red: la respuesta es real (Times Square -> JFK y Brooklyn,
grabada el 2026-11-03)."""
import asyncio
import json
from pathlib import Path

import httpx
import pytest

from app.providers.routing import MAX_DESTINATIONS, route_table
from app.services.cache import MemoryCache
from app.services.http import BREAKERS, UpstreamError

REAL = json.loads((Path(__file__).parent / "contracts" / "osrm_table_nyc.json").read_text("utf-8"))
HOTEL, JFK, BROOKLYN = (40.758, -73.9855), (40.6413, -73.7781), (40.6782, -73.9442)


@pytest.fixture(autouse=True)
def _fresh_breaker():
    BREAKERS.clear()
    yield
    BREAKERS.clear()


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_tiempos_reales_y_cache_permanente_compartida():
    seen = []

    def handler(r):
        seen.append(r)
        return httpx.Response(200, json=REAL)

    async def go():
        cache, client = MemoryCache(), _client(handler)
        first = await route_table(client, cache, HOTEL, [JFK, BROOKLYN])
        again = await route_table(client, cache, (40.758001, -73.985501), [JFK, BROOKLYN])  # mismo punto (~1 m)
        assert first == again == [{"distance_m": 27903, "duration_s": 1794}, {"distance_m": 16506, "duration_s": 1282}]
        assert len(seen) == 1 and seen[0].headers["user-agent"].startswith("TravelOpt/")
        assert "-73.9855,40.758;-73.7781,40.6413" in str(seen[0].url)  # OSRM usa lon,lat
        assert all(exp is None for _, exp, _ in cache._data.values())  # sin vencimiento: la red de calles no cambia

    asyncio.run(go())


def test_osrm_sin_ruta_o_con_error_no_inventa_ni_cachea():
    replies = [httpx.Response(200, json={"code": "NoTable"}),
               httpx.Response(200, json={"code": "Ok", "durations": [[0, None]], "distances": [[0, None]]})]

    async def go():
        cache, client = MemoryCache(), _client(lambda r: replies.pop(0))
        with pytest.raises(UpstreamError):
            await route_table(client, cache, HOTEL, [JFK])
        assert await route_table(client, cache, HOTEL, [JFK]) == [None]  # sin ruta: None, no un número inventado

    asyncio.run(go())


def test_limite_de_destinos():
    async def go():
        with pytest.raises(ValueError):
            await route_table(_client(lambda r: httpx.Response(200, json=REAL)), MemoryCache(), HOTEL,
                              [JFK] * (MAX_DESTINATIONS + 1))
        assert await route_table(_client(lambda r: httpx.Response(500)), MemoryCache(), HOTEL, []) == []

    asyncio.run(go())


def test_endpoint_de_rutas_responde_503_si_osrm_no_esta(api, monkeypatch):
    import app.api.main as main

    async def down(*a, **k):
        raise UpstreamError("osrm_public", 503, "caído")

    monkeypatch.setattr(main, "route_table", down)

    async def go():
        body = {"uid": "00000000-0000-4000-8000-0000000000aa", "origin": {"lat": 40.758, "lon": -73.9855},
                "destinations": [{"lat": 40.6413, "lon": -73.7781}]}
        return await api.post("/v1/routes", json=body)

    r = asyncio.run(go())
    assert r.status_code == 503 and r.json()["detail"]["code"] == "routing_unavailable"
