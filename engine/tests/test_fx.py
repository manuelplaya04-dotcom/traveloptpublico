"""Cotización del dólar para mostrar pesos: caché en la base, última guardada si la fuente falla, nunca inventada."""
import asyncio
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.services import fx
from app.services.cache import MemoryCache
from app.services.http import breaker_for

ROWS = [
    {"casa": "oficial", "venta": 1440, "fechaActualizacion": "2026-11-13T15:00:00.000Z"},
    {"casa": "bolsa", "venta": 1475.5, "fechaActualizacion": "2026-11-13T15:05:00.000Z"},
    {"casa": "tarjeta", "venta": 1872, "fechaActualizacion": "2026-11-13T15:00:00.000Z"},
]


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    async def no_sleep(_):
        return None

    monkeypatch.setattr(asyncio, "sleep", no_sleep)
    b = breaker_for(fx.PROVIDER)
    b.failures, b.opened_at = 0, None
    yield
    b.failures, b.opened_at = 0, None


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_tarjeta_y_mep_en_centavos_enteros_sin_flotantes():
    got = fx.pick(ROWS)
    assert got["tarjeta"]["cents_per_usd"] == 187200
    assert got["mep"]["cents_per_usd"] == 147550  # 1475.5 -> 147550, sin error de coma flotante


@pytest.mark.parametrize("bad", [
    [r for r in ROWS if r["casa"] != "tarjeta"],  # falta una: no se inventa
    [{**ROWS[2], "venta": -1}, ROWS[1]],
    [{**ROWS[2], "venta": "NaN"}, ROWS[1]],
    {"casa": "tarjeta"},
    "<html>",
])
def test_respuesta_inesperada_es_un_error_no_una_cotizacion(bad):
    with pytest.raises(fx.FxPayloadError):
        fx.pick(bad)


def test_se_cachea_y_una_segunda_consulta_no_sale_a_la_red():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(200, json=ROWS)

    async def go():
        cache, client = MemoryCache(), _client(handler)
        a = await fx.ars_rates(client, cache)
        b = await fx.ars_rates(client, cache)
        return a, b

    a, b = asyncio.run(go())
    assert calls == [fx.URL]
    assert a is not None and b is not None and not a.stale and a.mep.cents_per_usd == 147550


def test_si_la_fuente_falla_sirve_la_ultima_guardada_marcada_y_si_es_vieja_nada():
    async def go():
        cache = MemoryCache()
        fetched = datetime(2026, 11, 13, 12, tzinfo=UTC)
        await cache.set(fx.KEY, fx.PROVIDER, fx.pick(ROWS), ttl_s=-1, fetched_at=fetched)  # vencida
        down = _client(lambda r: httpx.Response(503))
        recent = await fx.ars_rates(down, cache, now=fetched + timedelta(hours=3))
        old = await fx.ars_rates(down, cache, now=fetched + timedelta(hours=25))
        empty = await fx.ars_rates(_client(lambda r: httpx.Response(200, json=[])), MemoryCache())
        return recent, old, empty

    recent, old, empty = asyncio.run(go())
    assert recent is not None and recent.stale and recent.tarjeta.cents_per_usd == 187200
    assert old is None and empty is None


def test_api_requiere_clave_y_responde_503_sin_cotizacion(api, monkeypatch):
    async def none(*_a, **_k):
        return None

    from app.api import main

    async def go():
        assert (await api.get("/v1/fx/ars", headers={"Authorization": ""})).status_code == 401
        monkeypatch.setattr(main, "ars_rates", none)
        r = await api.get("/v1/fx/ars")
        assert r.status_code == 503 and r.json()["detail"]["code"] == "fx_unavailable"

    asyncio.run(go())
