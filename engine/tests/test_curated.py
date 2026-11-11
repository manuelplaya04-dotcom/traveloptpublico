"""Actividades reales: precios publicados validados (data contract) + lugares de Wikidata como entrada en taquilla."""
import asyncio
import json
from datetime import date
from pathlib import Path

import httpx
import pytest
from pydantic import ValidationError

from app.providers.curated import CuratedCatalog, RealActivities, catalog
from app.services.cache import MemoryCache
from app.services.http import BREAKERS

PLACES = json.loads((Path(__file__).parent / "contracts" / "wikidata_places_nyc.json").read_text("utf-8"))
WEB_CITIES = (Path(__file__).parents[2] / "web" / "lib" / "cities.ts").read_text("utf-8")
DAY = date(2027, 1, 15)


@pytest.fixture(autouse=True)
def _fresh_breaker():
    BREAKERS.clear()
    yield
    BREAKERS.clear()


def test_el_catalogo_curado_cumple_su_contrato():
    cat = catalog()
    assert 10 <= len(cat.activities) <= 40
    assert all(a.link.startswith("https://") and a.source.startswith("https://") for a in cat.activities)
    with pytest.raises(ValidationError):  # un precio negativo o un campo de más no pasan
        CuratedCatalog.model_validate({"as_of": "2026-11-04", "activities": [
            {**cat.activities[0].model_dump(), "price_from_usd": -5}]})
    with pytest.raises(ValidationError):
        CuratedCatalog.model_validate({"as_of": "2026-11-04", "activities": [
            {**cat.activities[0].model_dump(), "inventado": True}]})


def test_los_imperdibles_de_la_web_tienen_precio_publicado():
    keys = {(a.city, a.key) for a in catalog().activities}
    for city, must in (("NYC", ["SOL", "TOR", "MOMA"]), ("ORL", ["MK", "EPCOT", "HS", "AK", "EPIC"])):
        assert "mustDo: [" + ", ".join(f'"{k}"' for k in must) + "]" in WEB_CITIES  # el catálogo de la web no cambió
        assert all((city, k) in keys for k in must)


def _real(handler):
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return RealActivities({"NYC": (40.758, -73.9855), "ORL": (28.3852, -81.5639)}, client, MemoryCache())


def test_curadas_con_precio_y_lugares_de_wikidata_como_taquilla_sin_duplicar():
    async def go():
        acts = await _real(lambda r: httpx.Response(200, json=PLACES)).activities([("NYC", DAY)])
        by_key = {a.activity_key: a for a in acts}
        moma = by_key["MOMA"]
        assert (moma.price_per_pax_minor, moma.price_source, moma.provider) == (3000, "curated", "precios_publicados")
        assert not any(a.name == "Museo de Arte Moderno" for a in acts)  # el MoMA de Wikidata es el mismo: no se repite
        park = next(a for a in acts if a.name == "Central Park")
        assert (park.price_per_pax_minor, park.price_source, park.provider) == (0, "box_office", "wikidata")
        assert all(a.provider in ("precios_publicados", "wikidata") for a in acts)  # nada simulado

    asyncio.run(go())


def test_mismo_lugar_con_coordenada_lejana_no_se_duplica():
    from app.providers.curated import _norm, _same

    epcot = next(a for a in catalog().activities if a.key == "EPCOT")
    assert _norm("EPCOT (1 día)") == _norm("Epcot") == "epcot"
    assert _same({"name": "Epcot", "lat": 28.3747 + 0.012, "lon": -81.5494}, epcot)  # ~1,3 km: el mismo parque
    assert not _same({"name": "Epcot", "lat": 28.3747 + 0.05, "lon": -81.5494}, epcot)  # ~5,5 km: otro lugar
    assert not _same({"name": "Lago Buena Vista", "lat": 28.3747 + 0.012, "lon": -81.5494}, epcot)
    epic = next(a for a in catalog().activities if a.key == "EPIC")
    assert _same({"name": "Universal Epic Universe", "lat": epic.lat + 0.01, "lon": epic.lon}, epic)  # ~1,1 km


def test_disney_cobra_por_fecha_y_se_marca_como_desde():
    async def go():
        acts = await _real(lambda r: httpx.Response(200, json={"results": {"bindings": []}})).activities([("ORL", DAY)])
        mk = next(a for a in acts if a.activity_key == "MK")
        assert mk.price_per_pax_minor == 15900 and mk.price_date_based

    asyncio.run(go())


def test_si_wikidata_no_responde_quedan_solo_las_curadas(monkeypatch):
    async def no_sleep(_):
        return None

    monkeypatch.setattr("app.services.http.asyncio.sleep", no_sleep)

    async def go():
        acts = await _real(lambda r: httpx.Response(503)).activities([("NYC", DAY), ("MIA", DAY)])
        assert acts and all(a.price_source == "curated" for a in acts)
        assert not any(a.city == "MIA" for a in acts)  # Miami sin curadas ni Wikidata: sin actividades, sin inventar

    asyncio.run(go())


def test_la_cache_de_wikidata_evita_llamadas_repetidas():
    seen = []

    def handler(r):
        seen.append(r)
        return httpx.Response(200, json=PLACES)

    async def go():
        real = _real(handler)
        await real.activities([("NYC", DAY)])
        await real.activities([("NYC", date(2027, 1, 16))])
        assert len(seen) == 1  # misma ciudad: de la caché

    asyncio.run(go())


def test_golden_en_modo_real_sigue_factible_con_imperdibles_a_precio_publicado(provider, plan, offers):
    """Mismo pedido Orlando + NYC con actividades reales y sin traslados cotizados: hay solución y los imperdibles
    salen con su precio publicado (el golden en modo fixture no cambia: ver test_golden_case)."""
    from app.optimizer.solver import optimize

    async def acts():
        return await _real(lambda r: httpx.Response(200, json={"results": {"bindings": []}})).activities(
            list(plan.city_days))

    real = offers.model_copy(update={"activities": asyncio.run(acts()), "transport": []})
    res = optimize(provider.trip_request(), real)
    assert res.status in ("ok", "over_budget") and res.itineraries
    best = res.itineraries[0]
    keys = {a.activity_key: a for st in best.stays for a in st.activities.items}
    assert {"MK", "EPCOT", "SOL"} <= set(keys)
    assert keys["MK"].price_per_pax_minor == 15900 and keys["SOL"].price_per_pax_minor == 2600
    assert {w.split(":")[0] for w in res.diagnostics["warnings"]} >= {"sin_transporte"}
