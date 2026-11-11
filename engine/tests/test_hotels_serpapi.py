"""Contrato del adapter de alojamiento (SerpApi google_hotels) y del medidor de cuota / modo histórico, sin red.

Las respuestas son reales (Nueva York, 15 al 19/01/2027, grabadas el 2026-11-03), recortadas y con los tokens de
propiedad reemplazados. Se sirven con httpx.MockTransport.
"""
import asyncio
import json
from datetime import date, timedelta
from pathlib import Path

import httpx
import pytest

from app.domain.models import Constraints
from app.optimizer.filters import lodging_rejection, unit_cost
from app.optimizer.skeletons import FlightQuery, Stay
from app.providers.flights import SerpApiFlights
from app.providers.hotels import LodgingQuotaExceeded, SerpApiHotels, normalize, parse
from app.services import serpapi
from app.services.cache import MemoryCache
from app.services.http import BREAKERS, RequestStats

KEY = "test-key-no-real"
REAL = json.loads((Path(__file__).parent / "contracts" / "serpapi_google_hotels_nyc.json").read_text("utf-8"))
NYC = Stay("NYC", date(2027, 1, 15), date(2027, 1, 19))
DAY = date.today() + timedelta(days=60)
FUTURE = Stay("MIA", DAY, DAY + timedelta(days=4))


@pytest.fixture(autouse=True)
def _fresh_breaker():
    BREAKERS.clear()
    yield
    BREAKERS.clear()


def _by_name(offers):
    return {o.name.split(" ")[0]: o for o in offers}


def test_hoteles_reales_normalizan_al_modelo_canonico():
    offers = parse(REAL["hotels"], NYC, "p", pax=5)
    assert len(offers) == 6  # 4 hoteles + 2 alquileres que Google mezcla en la búsqueda de hoteles
    yotel = _by_name(offers)["YOTEL"]
    u = yotel.units[0]
    # total_rate: 487 antes de impuestos, 573 final -> base + cargos concilian al centavo con el total cotizado
    assert (u.base_total_minor, u.fees_total_minor) == (48700, 8600) and unit_cost(yotel, u) == 57300
    assert (u.capacity, u.bedrooms, u.bathrooms, u.bathrooms_source) == (2, 1, 1, "inferred_per_room")
    assert u.available == 3  # 5 personas -> 3 habitaciones de 2
    assert (yotel.stars, yotel.rating, yotel.short_term_legal) == (4, 7.6, True)
    assert yotel.lat and yotel.lon and yotel.deeplink.startswith("https://") and yotel.amenities
    assert yotel.photo_url.startswith("https://lh3.googleusercontent.com/")  # miniatura para la tarjeta


def test_foto_de_un_host_no_permitido_queda_afuera():
    p = {**REAL["hotels"]["properties"][0], "images": [{"thumbnail": "https://evil.example/x.jpg"}]}
    assert normalize(p, NYC, "p", 2, None).photo_url is None


def test_alquiler_usa_capacidad_dormitorios_y_banos_informados():
    rentals = {o.name[:6]: o for o in parse(REAL["rentals"], NYC, "p", pax=5)}
    u = rentals["Lavish"].units[0]
    assert (u.capacity, u.bedrooms, u.bathrooms, u.bathrooms_source, u.available) == (8, 3, 2, "explicit", 1)
    sin_banos = rentals["10m to"].units[0]
    assert (sin_banos.bathrooms, sin_banos.bathrooms_source) == (1, "inferred_minimum")  # no se inventa un 2º baño
    assert rentals["Studio"].units[0].bedrooms == 0
    assert rentals["10m to"].deeplink == REAL["rentals"]["search_metadata"]["google_hotels_url"]  # sin link propio


def test_regla_de_banos_se_aplica_con_el_dato_real_o_el_minimo_cierto():
    c = Constraints(min_bathrooms=2, min_bedrooms=0)
    stay = Stay("MIA", NYC.check_in, NYC.check_out)  # fuera de NYC: sin regla de alquiler temporario
    rentals = {o.name[:6]: o for o in parse(REAL["rentals"], stay, "p", pax=4)}
    assert lodging_rejection(rentals["Lavish"], stay, c, 4) is None             # 2 baños informados
    assert lodging_rejection(rentals["10m to"], stay, c, 4) == "lodging.bathrooms"  # sin dato: 1, no alcanza
    hotel = _by_name(parse(REAL["hotels"], stay, "p", pax=4))["YOTEL"]
    assert lodging_rejection(hotel, stay, c, 4) is None  # 2 habitaciones = 2 baños privados


def test_cocina_con_el_dato_real_y_sin_suponer_en_hoteles():
    hotels = parse(REAL["hotels"], NYC, "p", pax=5)
    rentals = parse(REAL["rentals"], NYC, "p", pax=5)
    # respuesta real: los 6 alquileres informan "Kitchen"; los 4 hoteles traen un resumen sin cocina -> no se sabe
    assert [o.kitchen for o in hotels if o.units[0].bathrooms_source == "inferred_per_room"] == [None] * 4
    assert all(o.kitchen is True for o in rentals)
    assert all(o.kitchen is True for o in hotels if o.units[0].bathrooms_source != "inferred_per_room")


@pytest.mark.parametrize(("amenities", "rental", "expected"), [
    (["Wi-Fi", "Kitchenette"], False, True),
    (["Full kitchen"], True, True),
    (["Cocina"], False, True),
    (["Wi-Fi", "Air conditioning"], True, False),  # el alquiler publica su lista y no figura: no tiene
    (["Wi-Fi", "Air conditioning"], False, None),  # el hotel trae un resumen: no se sabe, nunca False
    ([], True, None),                              # sin lista: no se sabe
    (None, True, None),
    ("Kitchen", True, None),                       # formato inesperado: no se interpreta
    (["Kitchen-style restaurant", "Kitchen utensils"], False, None),
    ([f"Amenity {i}" for i in range(14)] + ["Kitchen"], True, True),  # se mira la lista completa, antes del recorte
])
def test_deteccion_de_cocina(amenities, rental, expected):
    from app.providers.hotels import kitchen
    assert kitchen(amenities, rental) is expected


def test_exigir_cocina_es_un_filtro_duro_con_motivo():
    stay = Stay("MIA", NYC.check_in, NYC.check_out)
    c = Constraints(min_bathrooms=0, min_bedrooms=0, require_kitchen=True)
    rental = parse(REAL["rentals"], stay, "p", pax=2)[0]
    hotel = _by_name(parse(REAL["hotels"], stay, "p", pax=2))["YOTEL"]
    assert lodging_rejection(rental, stay, c, 2) is None
    assert lodging_rejection(hotel, stay, c, 2) == "lodging.kitchen_unknown"
    assert lodging_rejection(rental.model_copy(update={"kitchen": False}), stay, c, 2) == "lodging.no_kitchen"
    # sin el filtro, la cocina no cambia nada
    assert lodging_rejection(hotel, stay, c.model_copy(update={"require_kitchen": False}), 2) is None


def test_alquiler_temporario_en_nueva_york_no_es_legal_por_menos_de_30_noches():
    offers = parse(REAL["hotels"], NYC, "p", pax=5)
    assert all(not o.short_term_legal for o in offers if o.units[0].bathrooms_source != "inferred_per_room")
    assert all(o.short_term_legal for o in offers if o.units[0].bathrooms_source == "inferred_per_room")
    long_stay = Stay("NYC", NYC.check_in, NYC.check_in + timedelta(days=30))
    assert all(o.short_term_legal for o in parse(REAL["rentals"], long_stay, "p", pax=5))


@pytest.mark.parametrize("broken", [
    {"name": "x", "type": "hotel"},                                                        # sin precio
    {"name": "", "type": "hotel", "total_rate": {"extracted_lowest": 100}},
    {"name": "x", "type": "vacation rental", "total_rate": {"extracted_lowest": 100}},     # sin capacidad
    {"name": "x", "type": "hotel", "total_rate": {"extracted_lowest": -5}},
])
def test_descarta_propiedades_incompletas(broken):
    assert normalize(broken, NYC, "p", 2, None) is None


def _hotels(handler, pax=2, **kw):
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    stats = RequestStats()
    return SerpApiHotels(KEY, client, MemoryCache(), stats, {"MIA": "Miami"}, pax, **kw), stats


def test_una_busqueda_por_estadia_cacheada_y_alquileres_solo_para_grupos():
    seen = []

    def handler(request):
        seen.append(dict(request.url.params))
        return httpx.Response(200, json=REAL["rentals" if "vacation_rentals" in request.url.params else "hotels"])

    async def go():
        prov, stats = _hotels(handler, pax=2)
        first = await prov.lodging([FUTURE])
        assert await prov.lodging([FUTURE]) == first and len(seen) == 1 and stats.cache_hits == 1
        assert first[0].fetched_at is not None  # fecha de cotización para "Cotizado hace X"
        p = seen[0]
        assert (p["q"], p["adults"], p["check_in_date"]) == ("Miami", "2", DAY.isoformat())
        group, _ = _hotels(handler, pax=5)
        await group.lodging([FUTURE])
        assert [s.get("vacation_rentals") for s in seen[1:]] == [None, "true"] and seen[2]["adults"] == "5"

    asyncio.run(go())


def test_tope_de_busquedas_de_alojamiento_antes_de_gastar_cuota():
    calls = []

    async def go():
        prov, _ = _hotels(lambda r: calls.append(r) or httpx.Response(200, json=REAL["hotels"]), pax=4, max_queries=3)
        with pytest.raises(LodgingQuotaExceeded):
            await prov.lodging([FUTURE, Stay("MIA", DAY, DAY + timedelta(days=5))])  # 2 estadías x 2 búsquedas
        assert calls == []

    asyncio.run(go())


# ---------------------------------------------------------------- medidor de cuota y modo histórico


def test_cuota_agotada_sirve_el_dato_guardado_marcado_historico():
    replies = [httpx.Response(200, json=REAL["hotels"]),
               httpx.Response(200, json={"error": "Your account has run out of searches."})]

    async def go():
        prov, stats = _hotels(lambda r: replies.pop(0))
        first = await prov.lodging([FUTURE])
        cache = prov.api.cache
        for k, (v, _, at) in list(cache._data.items()):  # la entrada vence: la próxima búsqueda va a la API
            cache._data[k] = (v, 0.0, at)
        again = await prov.lodging([FUTURE])
        assert [o.id for o in again] == [o.id for o in first] and again[0].fetched_at == first[0].fetched_at
        assert stats.stale_hits == 1 and serpapi.METER.exhausted()
        assert replies == []  # con la cuota agotada no se vuelve a llamar

    asyncio.run(go())


def test_cuota_agotada_sin_dato_guardado_es_un_error_controlado():
    calls = []

    async def go():
        serpapi.METER.mark_exhausted()
        prov, _ = _hotels(lambda r: calls.append(r) or httpx.Response(200, json=REAL["hotels"]))
        with pytest.raises(serpapi.QuotaExhausted):
            await prov.lodging([FUTURE])
        assert calls == []  # el medidor corta antes de gastar una búsqueda

    asyncio.run(go())


def test_medidor_lee_la_cuenta_sin_gastar_busquedas_y_respeta_la_reserva():
    seen = []

    def handler(request):
        seen.append(request.url.path)
        return httpx.Response(200, json={"total_searches_left": 3, "plan_searches_left": 3})

    async def go():
        meter = serpapi.QuotaMeter(refresh_s=600, clock=lambda: 1000.0)
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        await meter.refresh(client, KEY)
        await meter.refresh(client, KEY)  # dentro de la ventana: no vuelve a leer
        assert seen == ["/account.json"] and meter.left == 3
        assert not meter.exhausted(reserve=2) and meter.exhausted(reserve=3)
        meter.spent()
        assert meter.left == 2

    asyncio.run(go())


def test_vuelos_comparten_cuota_y_modo_historico():
    replies = [httpx.Response(200, json={"error": "Your account has run out of searches."})]

    async def go():
        serpapi.METER.left = 5
        prov = SerpApiFlights(KEY, httpx.AsyncClient(transport=httpx.MockTransport(lambda r: replies.pop(0))),
                              MemoryCache(), RequestStats())
        with pytest.raises(serpapi.QuotaExhausted):
            await prov.flights([FlightQuery(("EZE",), ("MIA",), DAY)])
        assert serpapi.METER.exhausted()  # un rechazo por cuota apaga también los hoteles

    asyncio.run(go())
