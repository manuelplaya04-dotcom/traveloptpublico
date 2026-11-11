"""Lugares reales (Wikidata) sin red: respuesta real grabada (Nueva York, 2026-11-03)."""
import asyncio
import json
from pathlib import Path

import httpx
import pytest

from app.providers.places import parse, places_near
from app.services.cache import MemoryCache
from app.services.http import BREAKERS, UpstreamError

REAL = json.loads((Path(__file__).parent / "contracts" / "wikidata_places_nyc.json").read_text("utf-8"))


@pytest.fixture(autouse=True)
def _fresh_breaker():
    BREAKERS.clear()
    yield
    BREAKERS.clear()


def test_lugares_reales_sin_duplicados_con_el_tipo_mas_representativo():
    places = parse(REAL)
    names = [p.name for p in places]
    assert len(names) == len(set(names)) and len(places) <= 16
    by_name = {p.name: p for p in places}
    assert by_name["Museo de Arte Moderno"].kind == "Museo de arte"  # es "museo" y "museo de arte": el más preciso
    assert not by_name["Museo de Arte Moderno"].outdoor and by_name["Central Park"].outdoor
    assert by_name["Estatua de la Libertad"].kind == "Mirador"  # el único tipo que Wikidata le da de la lista
    assert all(p.link.startswith("https://") for p in places)
    assert [p.relevance for p in places] == sorted((p.relevance for p in places), reverse=True)
    assert not hasattr(places[0], "price")  # Wikidata no publica precios: no se inventan


def test_si_wikidata_no_responde_sirve_lo_guardado_y_si_no_hay_falla(monkeypatch):
    async def no_sleep(_):
        return None

    monkeypatch.setattr("app.services.http.asyncio.sleep", no_sleep)
    up = {"ok": True}

    def handler(r):
        assert r.headers["user-agent"].startswith("TravelOpt/")
        return httpx.Response(200, json=REAL) if up["ok"] else httpx.Response(503)

    async def go():
        cache, client = MemoryCache(), httpx.AsyncClient(transport=httpx.MockTransport(handler))
        first = await places_near(client, cache, 40.758, -73.9855)
        for k, (v, _, at) in list(cache._data.items()):
            cache._data[k] = (v, 0.0, at)  # vencido
        up["ok"] = False
        again = await places_near(client, cache, 40.758, -73.9855)
        assert again["places"] == first["places"] and again["stale"] and not first["stale"]
        with pytest.raises(UpstreamError):
            await places_near(client, MemoryCache(), 40.758, -73.9855)

    asyncio.run(go())


def test_la_consulta_excluye_lugares_cerrados():
    from app.providers.places import query

    q = query(28.38, -81.56)
    assert all(f"wdt:{prop}" in q for prop in ("P576", "P3999", "P582")) and "FILTER NOT EXISTS" in q


def test_lugares_cerrados_que_wikidata_no_marca_se_excluyen():
    from app.providers.places import CLOSED_QIDS

    binding = {"item": {"value": f"http://www.wikidata.org/entity/{next(iter(CLOSED_QIDS))}"},
               "coord": {"value": "Point(-81.52 28.37)"}, "type": {"value": "http://www.wikidata.org/entity/Q2416723"},
               "itemLabel": {"value": "DisneyQuest"}, "sitelinks": {"value": "12"}}
    assert parse({"results": {"bindings": [binding]}}) == []
