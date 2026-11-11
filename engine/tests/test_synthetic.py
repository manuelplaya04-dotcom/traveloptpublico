"""Datos simulados de la demo: responden al pedido, son determinísticos y no tocan el golden."""
import asyncio
import re

from app.domain.models import TripRequest
from app.optimizer.skeletons import build_query_plan, generate_skeletons
from app.optimizer.solver import optimize
from app.providers.base import collect_offers
from app.providers.fixture import FixtureProvider, get_fixture
from app.providers.registry import _demo_provider
from app.providers.synthetic import SyntheticProvider
from tests.test_resilience import GOLDEN_MINOR

BASE = FixtureProvider("orlando_nyc_5pax").trip_request().model_dump(mode="json")
PAR = dict(code="PAR", name="París", airports=["CDG", "ORY"], lat=48.8566, lon=2.3522, must_do=[])
ROM = dict(code="ROM", name="Roma", airports=["FCO"], lat=41.9028, lon=12.4964, must_do=[])


def _req(cities: list[dict], **patch) -> TripRequest:
    nights = sum(c["min_nights"] for c in cities)
    return TripRequest.model_validate({**BASE, "cities": cities, "total_nights_min": nights, "total_nights_max": nights, **patch})


def _paris(nights: int, **patch) -> TripRequest:
    return _req([{**PAR, "min_nights": nights, "max_nights": nights}], **patch)


def _solve(req: TripRequest):
    plan = build_query_plan(req, generate_skeletons(req))
    return optimize(req, asyncio.run(collect_offers(plan, _demo_provider(req))))


def test_el_caso_golden_sigue_usando_el_fixture_y_su_optimo():
    golden = TripRequest.model_validate(BASE)
    assert _demo_provider(golden) is get_fixture("orlando_nyc_5pax")
    # sin case_key (la web ya no lo manda) el motor reconoce el caso igual, por ruta, fechas y noches
    assert _demo_provider(golden.model_copy(update={"case_key": None})) is get_fixture("orlando_nyc_5pax")
    assert _solve(golden).itineraries[0].total_minor == GOLDEN_MINOR


def test_otra_ciudad_genera_datos_con_su_nombre_y_encuentra_itinerario():
    res = _solve(_paris(5))
    assert res.status == "ok"
    best = res.itineraries[0]
    assert best.skeleton.id.startswith("PAR|")
    assert "París" in best.stays[0].lodging.offer.name
    assert best.stays[0].lodging.offer.provider == "simulado"


def test_el_resultado_cambia_con_noches_viajeros_fechas_y_destinos():
    totals = {
        "5n": _solve(_paris(5)).itineraries[0].total_minor,
        "9n": _solve(_paris(9)).itineraries[0].total_minor,
        "2pax": _solve(_paris(5, pax=2)).itineraries[0].total_minor,
        "dic": _solve(_paris(5, first_checkin_from="2027-12-10", first_checkin_to="2027-12-10")).itineraries[0].total_minor,
        "roma": _solve(_req([{**ROM, "min_nights": 5, "max_nights": 5}])).itineraries[0].total_minor,
    }
    assert len(set(totals.values())) == len(totals), totals
    assert totals["2pax"] < totals["5n"] < totals["9n"]


def test_mismo_pedido_mismas_ofertas():
    req = _req([{**PAR, "min_nights": 4, "max_nights": 4}, {**ROM, "min_nights": 4, "max_nights": 4}])
    plan = build_query_plan(req, generate_skeletons(req))
    a = asyncio.run(collect_offers(plan, SyntheticProvider(req)))
    b = asyncio.run(collect_offers(plan, SyntheticProvider(req)))
    assert a == b and a.flights and a.lodging and a.activities and a.weather and a.transport


def test_orden_invertido_usa_los_datos_conocidos_del_fixture_y_vuelos_simulados():
    golden = TripRequest.model_validate(BASE)
    req = TripRequest.model_validate({**BASE, "cities": list(reversed(BASE["cities"]))})
    assert isinstance(_demo_provider(req), SyntheticProvider)
    res = _solve(req)
    assert res.status == "ok"  # las actividades obligatorias (MK, MoMA…) salen del fixture
    # ORL/NYC fuera del caso de prueba: alojamientos del fixture y simulados conviven como opciones
    plan = build_query_plan(req, generate_skeletons(req))
    offers = asyncio.run(collect_offers(plan, _demo_provider(req)))
    assert {o.provider for o in offers.lodging} == {"fixture", "simulado"}
    assert res.itineraries[0].total_minor != _solve(golden).itineraries[0].total_minor


def test_los_links_simulados_son_https_reales():
    req = _paris(3)
    plan = build_query_plan(req, generate_skeletons(req))
    offers = asyncio.run(collect_offers(plan, SyntheticProvider(req)))
    links = [o.deeplink for group in (offers.flights, offers.lodging, offers.activities, offers.transport) for o in group]
    assert links and all(link and link.startswith("https://") and "example" not in link for link in links)


# Fase 1: las 8 ciudades del catálogo de la web, con los imperdibles que manda la web según las noches.
PHASE1 = {"NYC": (["JFK", "LGA", "EWR"], 40.758, -73.9855, ["SOL", "TOR", "MOMA"], [0, 2, 3]),
          "ORL": (["MCO"], 28.3852, -81.5639, ["MK", "EPCOT", "HS", "AK", "EPIC"], [0, 0, 1, 2, 3, 3, 4, 5]),
          "MIA": (["MIA"], 25.7617, -80.1918, [], None), "PHL": (["PHL"], 39.9526, -75.1652, [], None),
          "BOS": (["BOS"], 42.3601, -71.0589, [], None), "WAS": (["IAD", "DCA"], 38.9072, -77.0369, [], None),
          "BKN": (["JFK", "LGA"], 40.6782, -73.9442, [], None)}


def _must(code: str, n: int) -> list[str]:
    must_do, table = PHASE1[code][3], PHASE1[code][4]
    return must_do if table is None else must_do[:table[min(max(n, 1), len(table)) - 1]]


def test_fase1_cualquier_entrada_logica_llega_a_un_itinerario():
    """Garantía del camino feliz: 1 a 4 ciudades, 1 a 10 noches, 1 a 9 viajeros, cualquier fecha, escalas, baños,
    valijas y tolerancia de lluvia. Siempre hay itinerario (dentro o fuera del presupuesto), nunca "sin opciones"."""
    import random
    from datetime import date, timedelta

    rnd = random.Random(42)
    for _ in range(60):
        codes = rnd.sample(list(PHASE1), rnd.randint(1, 4))
        if "NYC" in codes and "BKN" in codes:  # la web no deja combinarlas (mismos aeropuertos)
            codes.remove("BKN")
        nights = [rnd.randint(1, 10) for _ in codes]
        start = date(2026, 11, 2) + timedelta(days=rnd.randint(0, 720))
        cities = [dict(code=c, name=c, airports=PHASE1[c][0], lat=PHASE1[c][1], lon=PHASE1[c][2],
                       min_nights=n, max_nights=n, must_do=_must(c, n)) for c, n in zip(codes, nights)]
        req = _req(cities, pax=rnd.randint(1, 9), budget_minor=rnd.randint(10, 30_000) * 100,
                   first_checkin_from=str(start), first_checkin_to=str(start + timedelta(days=rnd.randint(0, 3))),
                   constraints={**BASE["constraints"], "max_stops": rnd.randint(0, 2), "min_bathrooms": rnd.randint(0, 4),
                                "checked_bags_per_pax": rnd.randint(0, 2), "max_heavy_rain_prob": round(rnd.random(), 2)})
        assert _solve(req).status in ("ok", "over_budget"), (codes, nights, req.constraints)


def test_estadia_minima_calibrada_al_80_por_ciento():
    from app.providers.synthetic import calibrate_min_stay

    req = _req([{**PAR, "name": "Miami", "code": "MIA", "min_nights": 1, "max_nights": 1}])
    plan = build_query_plan(req, generate_skeletons(req))
    offers = calibrate_min_stay(asyncio.run(SyntheticProvider(req).lodging(list(plan.stays))))
    by_stay: dict = {}
    for o in offers:
        by_stay.setdefault((o.check_in, o.check_out), []).append(o)
    for (ci, co), group in by_stay.items():
        assert sum(o.min_nights <= (co - ci).days for o in group) >= 0.8 * len(group)


def test_sin_coordenadas_no_se_inventan_vuelos():
    """Un aeropuerto de origen desconocido no recibe una distancia de relleno: la ruta queda sin oferta (y el motor
    lo explica en el embudo), en lugar de una opción genérica."""
    req = _paris(3, origin_airports=["XXX"])
    plan = build_query_plan(req, generate_skeletons(req))
    offers = asyncio.run(collect_offers(plan, SyntheticProvider(req)))
    assert not [f for f in offers.flights if "XXX" in (f.origin, f.destination)]
    assert _solve(req).status == "infeasible"



def test_el_motor_no_genera_partidos_ni_fechas_deportivas():
    """Cero datos inventados: sin calendario real gratuito, el motor no ofrece partidos (los deportes son información
    estática con link al calendario oficial, en la web)."""
    req = _req([{**PAR, "code": "BOS", "name": "Boston", "airports": ["BOS"], "lat": 42.3601, "lon": -71.0589,
                 "min_nights": 4, "max_nights": 4}], first_checkin_from="2027-07-08", first_checkin_to="2027-07-08")
    plan = build_query_plan(req, generate_skeletons(req))
    acts = asyncio.run(collect_offers(plan, _demo_provider(req))).activities
    assert acts and not [a for a in acts if re.match(r"^(NBA|NHL|MLB|NFL|MLS) ", a.name)]
