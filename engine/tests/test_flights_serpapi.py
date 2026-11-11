"""Contrato del adapter de vuelos (SerpApi google_flights) sin red: respuestas con la forma documentada por SerpApi,
servidas con httpx.MockTransport, más una respuesta real grabada en tests/contracts/."""
import asyncio
import json
from datetime import date, datetime, timedelta
from pathlib import Path

import httpx
import pytest

from app.domain.models import FlightOffer
from app.optimizer.skeletons import FlightQuery
from app.providers.flights import SEATS_UNKNOWN, FlightQuotaExceeded, SerpApiFlights, normalize, parse
from app.services.cache import MemoryCache
from app.services.http import BREAKERS, RequestStats, UpstreamError

KEY = "test-key-no-real"
DAY = date.today() + timedelta(days=60)
URL = "https://www.google.com/travel/flights?hl=en&gl=us&curr=USD&tfs=x"


def _segment(no: str, frm: str, to: str, dep: str, arr: str) -> dict:
    return {"departure_airport": {"name": frm, "id": frm, "time": dep},
            "arrival_airport": {"name": to, "id": to, "time": arr},
            "duration": 120, "airplane": "Boeing 787", "airline": "x", "travel_class": "Economy",
            "flight_number": no, "legroom": "31 in", "extensions": []}


DIRECT = {"flights": [_segment("AR 1302", "EZE", "JFK", f"{DAY} 22:30", f"{DAY + timedelta(days=1)} 07:10")],
          "total_duration": 640, "price": 812, "type": "One way", "booking_token": "tok1"}
ONE_STOP = {"flights": [_segment("CM 702", "EZE", "PTY", f"{DAY} 09:00", f"{DAY} 15:05"),
                        _segment("CM 804", "PTY", "EWR", f"{DAY} 17:00", f"{DAY} 23:20")],
            "layovers": [{"duration": 115, "name": "Tocumen", "id": "PTY"}],
            "total_duration": 860, "price": 655, "type": "One way", "booking_token": "tok2"}


def _response(*best, other=()) -> dict:
    return {"search_metadata": {"status": "Success", "google_flights_url": URL},
            "best_flights": list(best), "other_flights": list(other)}


@pytest.fixture(autouse=True)
def _fresh_breaker():
    BREAKERS.clear()
    yield
    BREAKERS.clear()


def test_normaliza_al_modelo_canonico():
    o = normalize(ONE_STOP, "serpapi_google_flights", URL)
    assert isinstance(o, FlightOffer)
    assert (o.origin, o.destination, o.carrier, o.stops) == ("EZE", "EWR", "CM", 1)
    assert o.price_per_pax_minor == 65500 and isinstance(o.price_per_pax_minor, int)  # USD enteros -> centavos
    assert o.depart_at == datetime.fromisoformat(f"{DAY}T09:00")  # hora local, ISO 8601, sin zona
    assert o.arrive_at == datetime.fromisoformat(f"{DAY}T23:20")
    assert (o.included_bags, o.bag_fee_minor, o.seats_available) == (0, 0, SEATS_UNKNOWN)
    assert o.deeplink == URL and o.provider == "serpapi_google_flights"
    assert o.id == normalize(ONE_STOP, "serpapi_google_flights", URL).id  # id determinista


def test_vuelo_directo_que_llega_al_dia_siguiente():
    o = normalize(DIRECT, "p", None)
    assert o.stops == 0 and o.carrier == "AR" and o.arrive_at.date() == DAY + timedelta(days=1)


@pytest.mark.parametrize("broken", [
    {**DIRECT, "price": None},                       # Google a veces lista opciones sin precio
    {**DIRECT, "price": "812"},
    {**DIRECT, "price": -1},
    {**DIRECT, "flights": []},
    {**DIRECT, "flights": [{**DIRECT["flights"][0], "flight_number": "Varios"}]},
    {**DIRECT, "flights": [{**DIRECT["flights"][0], "departure_airport": {"id": "EZE", "time": "22:30"}}]},
])
def test_descarta_opciones_incompletas_sin_romper(broken):
    assert normalize(broken, "p", None) is None


def test_parse_deduplica_y_rechaza_links_no_https():
    data = _response(DIRECT, ONE_STOP, other=[DIRECT])
    data["search_metadata"]["google_flights_url"] = "http://inseguro.example"
    offers = parse(data, "p")
    assert len(offers) == 2 and all(o.deeplink is None for o in offers)


def test_sin_resultados_es_lista_vacia_y_otro_error_falla():
    assert parse({"error": "Google Flights hasn't returned any results for this query."}, "p") == []
    with pytest.raises(UpstreamError):
        parse({"error": "Invalid API key."}, "p")


def _adapter(handler, **kw):
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    stats = RequestStats()
    return SerpApiFlights(KEY, client, MemoryCache(), stats, **kw), stats


def test_respuesta_real_grabada_normaliza_completa():
    # MCO -> NYC del 2027-01-15, grabada el 2026-11-03 (recortada a 7 opciones, sin metadatos con URLs ni clave).
    data = json.loads((Path(__file__).parent / "contracts" / "serpapi_google_flights_mco_nyc.json").read_text("utf-8"))
    offers = parse(data, "serpapi_google_flights")
    assert len(offers) == 7  # ninguna opción real se pierde al normalizar
    assert all(o.origin == "MCO" and o.destination in {"JFK", "LGA", "EWR"} for o in offers)
    assert all(o.depart_at.date() == date(2027, 1, 15) and o.arrive_at > o.depart_at for o in offers)
    assert sorted(o.price_per_pax_minor for o in offers) == [8400, 9400, 9900, 11900, 11900, 11900, 11900]
    assert [o.stops for o in offers].count(1) == 1
    assert all(o.deeplink and o.deeplink.startswith("https://www.google.com/travel/flights") for o in offers)


def test_cache_first_y_la_clave_no_se_cachea_ni_se_loguea():
    seen = []

    def handler(request: httpx.Request):
        seen.append(dict(request.url.params))
        return httpx.Response(200, json=_response(DIRECT))

    async def go():
        prov, stats = _adapter(handler)
        q = FlightQuery(("EZE",), ("JFK", "LGA", "EWR"), DAY)
        first = await prov.flights([q])
        second = await prov.flights([q])  # misma ruta y fecha: desde la caché, sin tocar la API
        assert first == second and len(first) == 1
        assert len(seen) == 1 and stats.api_calls == 1 and stats.cache_hits == 1
        p = seen[0]
        assert p["api_key"] == KEY and p["arrival_id"] == "JFK,LGA,EWR" and p["adults"] == "1"
        assert p["type"] == "2" and p["currency"] == "USD" and p["outbound_date"] == DAY.isoformat()
        assert all(KEY not in str(e) for e in stats.events)  # el log de uso nunca guarda la clave
        assert "api_key" not in SerpApiFlights.params(q)       # la clave de caché tampoco

    asyncio.run(go())


def test_un_error_del_proveedor_no_queda_cacheado():
    replies = [{"error": "Google Flights is temporarily unavailable."}, _response(DIRECT)]

    def handler(request):
        return httpx.Response(200, json=replies.pop(0))

    async def go():
        prov, _ = _adapter(handler)
        q = FlightQuery(("EZE",), ("JFK",), DAY)
        with pytest.raises(UpstreamError):
            await prov.flights([q])
        assert len(await prov.flights([q])) == 1  # el siguiente pedido vuelve a consultar

    asyncio.run(go())


def test_tope_de_busquedas_por_corrida_antes_de_gastar_cuota():
    calls = []

    async def go():
        prov, _ = _adapter(lambda r: calls.append(r) or httpx.Response(200, json=_response()), max_queries=2)
        qs = [FlightQuery(("EZE",), ("JFK",), DAY + timedelta(days=i)) for i in range(3)]
        with pytest.raises(FlightQuotaExceeded):
            await prov.flights(qs)
        assert calls == []

    asyncio.run(go())


def test_no_cotiza_fechas_pasadas():
    calls = []

    async def go():
        prov, _ = _adapter(lambda r: calls.append(r) or httpx.Response(200, json=_response(DIRECT)))
        assert await prov.flights([FlightQuery(("EZE",), ("JFK",), date.today() - timedelta(days=1))]) == []
        assert calls == []

    asyncio.run(go())


def test_rate_limit_429_reintenta_con_backoff(monkeypatch):
    replies = [httpx.Response(429, headers={"Retry-After": "0"}), httpx.Response(200, json=_response(DIRECT))]
    sleeps = []

    async def fake_sleep(s):
        sleeps.append(s)

    monkeypatch.setattr("app.services.http.asyncio.sleep", fake_sleep)

    async def go():
        prov, stats = _adapter(lambda r: replies.pop(0))
        assert len(await prov.flights([FlightQuery(("EZE",), ("JFK",), DAY)])) == 1
        assert stats.api_calls == 2 and len(sleeps) == 1

    asyncio.run(go())


def test_registry_activa_vuelos_reales_solo_con_clave():
    from app.providers.fixture import get_fixture
    from app.providers.registry import build_providers
    from app.settings import Settings

    req = get_fixture("orlando_nyc_5pax").trip_request()
    client, cache, stats = httpx.AsyncClient(), MemoryCache(), RequestStats()

    def build(mode, key):
        s = Settings(_env_file=None, engine_api_key="x" * 24, serpapi_api_key=key)
        return build_providers(mode, req, s, client, cache, stats)

    assert isinstance(build("hybrid", KEY)["flights"], SerpApiFlights)
    assert not isinstance(build("hybrid", None)["flights"], SerpApiFlights)  # sin clave: vuelos de ejemplo
    live = build("live", KEY)
    assert all(live[k] is not None for k in ("flights", "lodging", "activities", "transport", "weather"))
    assert build("live", None)["flights"] is None  # sin clave: vuelos no configurados (501), nunca de ejemplo
    real = build("hybrid", KEY)  # con clave, ningún proveedor de ejemplo en ninguna categoría
    assert not any(type(p).__name__ in ("FixtureProvider", "SyntheticProvider") for p in real.values())
    assert not isinstance(build("fixture", KEY)["flights"], SerpApiFlights)  # el caso golden no cambia


def test_valijas_con_tarifa_publicada_solo_en_vuelos_dentro_de_eeuu():
    from app.providers.bag_fees import bag_fee_per_bag_minor

    data = json.loads((Path(__file__).parent / "contracts" / "serpapi_google_flights_mco_nyc.json").read_text("utf-8"))
    offers = {o.carrier: o for o in parse(data, "serpapi_google_flights", bags=1)}
    assert (offers["DL"].bag_fee_minor, offers["DL"].bag_fee_known) == (4500, True)
    assert (offers["B6"].bag_fee_minor, offers["B6"].bag_fee_known) == (4900, True)  # temporada alta: no subestima
    assert (offers["F9"].bag_fee_minor, offers["F9"].bag_fee_known) == (0, False)  # sin tarifa publicada en la tabla
    assert bag_fee_per_bag_minor("AA", "EZE", "MIA", 1) is None  # internacional: depende de la tarifa
    assert bag_fee_per_bag_minor("AA", "MCO", "JFK", 2) == 5000  # (45 + 55) / 2
    assert bag_fee_per_bag_minor("AA", "MCO", "JFK", 3) is None  # 3.ª valija: sin tarifa publicada
    assert bag_fee_per_bag_minor("AA", "MCO", "JFK", 0) == 0
    no_bags = parse(data, "serpapi_google_flights", bags=0)
    assert all(o.bag_fee_minor == 0 and o.bag_fee_known for o in no_bags)
