"""Presupuesto de cuota por corrida y casos de caos de SerpApi (sin red): recorte del plan, falla parcial sin cascada,
dos usuarios a la vez sobre la misma búsqueda y la reserva de cuota."""
import asyncio
import json
from datetime import date, timedelta
from pathlib import Path

import httpx
import pytest

from app.optimizer.skeletons import FlightQuery, Stay
from app.providers.flights import SerpApiFlights
from app.providers.hotels import SerpApiHotels
from app.services import serpapi
from app.services.cache import MemoryCache, cache_key
from app.services.http import BREAKERS, RequestStats, UpstreamError
from app.services.quota_plan import effective_request, narrow
from app.settings import get_settings

KEY = "test-key-no-real"
HOTELS = json.loads((Path(__file__).parent / "contracts" / "serpapi_google_hotels_nyc.json").read_text("utf-8"))
FLIGHTS = json.loads((Path(__file__).parent / "contracts" / "serpapi_google_flights_mco_nyc.json").read_text("utf-8"))
DAY = date.today() + timedelta(days=60)
STAY = Stay("MIA", DAY, DAY + timedelta(days=4))


@pytest.fixture(autouse=True)
def _fresh_breaker():
    BREAKERS.clear()
    yield
    BREAKERS.clear()


def _flights(handler, cache=None):
    stats = RequestStats()
    return SerpApiFlights(KEY, httpx.AsyncClient(transport=httpx.MockTransport(handler)), cache or MemoryCache(),
                          stats), stats


def _qs(n):
    return [FlightQuery(("EZE",), ("MIA",), DAY + timedelta(days=i)) for i in range(n)]


# ---------------------------------------------------------------- falla parcial sin cascada


def test_falla_en_la_busqueda_4_devuelve_las_otras_3_sin_tumbar_la_corrida(monkeypatch):
    async def no_sleep(_):
        return None

    monkeypatch.setattr("app.services.http.asyncio.sleep", no_sleep)
    bad = (DAY + timedelta(days=3)).isoformat()

    def handler(r):
        return httpx.Response(500) if r.url.params["outbound_date"] == bad else httpx.Response(200, json=FLIGHTS)

    async def go():
        prov, stats = _flights(handler)
        offers = await prov.flights(_qs(4))
        assert offers and stats.partial_failures == 1 and stats.stale_hits == 0

    asyncio.run(go())


def test_la_busqueda_que_falla_usa_su_ultimo_dato_real_guardado(monkeypatch):
    async def no_sleep(_):
        return None

    monkeypatch.setattr("app.services.http.asyncio.sleep", no_sleep)
    fail = {"on": False}

    def handler(r):
        return httpx.Response(503) if fail["on"] else httpx.Response(200, json=FLIGHTS)

    async def go():
        cache = MemoryCache()
        prov, _ = _flights(handler, cache)
        first = await prov.flights(_qs(2))
        for k, (v, _, at) in list(cache._data.items()):  # vence todo: la próxima vez va a la API, que está caída
            cache._data[k] = (v, 0.0, at)
        fail["on"] = True
        prov2, stats = _flights(handler, cache)
        again = await prov2.flights(_qs(2))
        assert [o.id for o in again] == [o.id for o in first] and stats.stale_hits == 2 and not stats.partial_failures

    asyncio.run(go())


def test_si_fallan_todas_y_no_hay_nada_guardado_la_falla_se_propaga(monkeypatch):
    async def no_sleep(_):
        return None

    monkeypatch.setattr("app.services.http.asyncio.sleep", no_sleep)

    async def go():
        prov, _ = _flights(lambda r: httpx.Response(500))
        with pytest.raises(UpstreamError):
            await prov.flights(_qs(2))

    asyncio.run(go())


# ---------------------------------------------------------------- carrera en la caché


def test_dos_usuarios_a_la_vez_con_cache_miss_gastan_una_sola_busqueda():
    calls = []

    async def handler(r):
        calls.append(r)
        await asyncio.sleep(0.05)  # la respuesta tarda: el segundo pedido llega mientras el primero está en vuelo
        return httpx.Response(200, json=HOTELS["hotels"])

    async def go():
        client, cache = httpx.AsyncClient(transport=httpx.MockTransport(handler)), MemoryCache()
        a = SerpApiHotels(KEY, client, cache, RequestStats(), {"MIA": "Miami"}, 2)
        b = SerpApiHotels(KEY, client, cache, RequestStats(), {"MIA": "Miami"}, 2)
        ra, rb = await asyncio.gather(a.lodging([STAY]), b.lodging([STAY]))
        assert ra == rb and len(calls) == 1

    asyncio.run(go())


# ---------------------------------------------------------------- reserva de cuota


def test_al_llegar_a_la_reserva_entra_en_modo_historico_sin_gastar():
    calls = []

    async def go():
        cache = MemoryCache()
        params = SerpApiHotels(KEY, None, cache, None, {"MIA": "Miami"}, 2).params(STAY, False)
        await cache.set(cache_key("serpapi_google_hotels", serpapi.URL, params), "x", HOTELS["hotels"], ttl_s=-1)
        serpapi.METER.left = 20  # quedan 20 = la reserva: se protegen
        prov = SerpApiHotels(KEY, httpx.AsyncClient(transport=httpx.MockTransport(lambda r: calls.append(r))),
                             cache, RequestStats(), {"MIA": "Miami"}, 2, reserve=20)
        offers = await prov.lodging([STAY])
        assert offers and calls == [] and prov.api.stats.stale_hits == 1

    asyncio.run(go())


def test_la_reserva_por_defecto_es_20():
    from app.settings import Settings

    assert Settings(_env_file=None, engine_api_key="x" * 24).serpapi_quota_reserve == 20


# ---------------------------------------------------------------- presupuesto por corrida


def test_recortes_no_tocan_restricciones_duras(req):
    n = narrow(req, ["flex", "overnight"])
    assert n.first_checkin_to == n.first_checkin_from and not n.constraints.allow_overnight_outbound
    assert n.constraints.model_dump(exclude={"allow_overnight_outbound"}) == \
        req.constraints.model_dump(exclude={"allow_overnight_outbound"})
    assert effective_request(req, {}) is req and effective_request(req, {"quota_narrowed": ["x"]}) is req


def _plan_summary(api, monkeypatch, warm=None):
    monkeypatch.setenv("SERPAPI_API_KEY", KEY)
    get_settings.cache_clear()
    from app.api.main import app

    async def go():
        if warm:
            await warm(app.state.cache)
        r = await api.post("/v1/dev/runs/orlando_nyc_5pax", params={"trigger": "false", "mode": "hybrid"})
        rid = r.json()["run_id"]
        assert (await api.post(f"/v1/runs/{rid}/plan")).status_code == 200
        return (await api.get(f"/v1/runs/{rid}")).json()["summary"]

    try:
        return asyncio.run(go())
    finally:
        get_settings.cache_clear()


def test_plan_grande_se_recorta_hasta_el_presupuesto_y_lo_deja_registrado(api, monkeypatch):
    s = _plan_summary(api, monkeypatch)
    # golden en hybrid: 9 vuelos + 12 estadías x 2 = 33 búsquedas pagas -> se recorta todo lo recortable
    assert s["quota_narrowed"] == ["flex", "overnight", "rentals"]
    assert s["query_plan"]["flights"] < 9 and s["query_plan"]["lodging"] < 12


def test_lo_que_esta_en_cache_no_cuenta_y_no_se_recorta_nada(api, monkeypatch, req):
    from app.api.main import plan_for

    async def warm(cache):
        plan = plan_for(req)
        hotels = SerpApiHotels(KEY, None, cache, None, {c.code: c.name or c.code for c in req.cities}, req.pax)
        for q in plan.flights:
            await cache.set(cache_key("serpapi_google_flights", serpapi.URL, SerpApiFlights.params(q)), "x", {}, 3600)
        for st in plan.stays:
            for rentals in (False, True):
                await cache.set(cache_key("serpapi_google_hotels", serpapi.URL, hotels.params(st, rentals)), "x", {},
                                3600)

    s = _plan_summary(api, monkeypatch, warm)
    assert "quota_narrowed" not in s and s["serpapi_queries"] == 0


def test_panel_de_cuota_muestra_saldo_y_reserva(api, monkeypatch):
    serpapi.METER.left = 123

    async def go():
        return await api.get("/v1/quota")

    r = asyncio.run(go())
    body = r.json()
    assert r.status_code == 200 and body["serpapi"]["reserve"] == 20 and "alerts" in body
    assert body["serpapi"]["searches_left"] == 123 or not body["serpapi"]["configured"]
