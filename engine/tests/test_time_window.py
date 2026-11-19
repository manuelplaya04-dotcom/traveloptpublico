"""Franja horaria de vuelos: sin límite si la persona no la pidió (None); el caso golden la fija y no se mueve."""
from datetime import date, datetime

from app.domain.models import Constraints, FlightOffer, TripRequest
from app.optimizer.filters import flight_rejection
from app.optimizer.skeletons import Leg
from app.providers.fixture import FixtureProvider

DAWN = FlightOffer(id="f", provider="p", origin="EZE", destination="MIA", depart_at=datetime(2027, 7, 8, 1, 30),
                   arrive_at=datetime(2027, 7, 8, 23, 50), stops=0, carrier="AA", price_per_pax_minor=1,
                   seats_available=9)
LEG = Leg(("EZE",), ("MIA",), (date(2027, 7, 8),), date(2027, 7, 8))


def test_sin_franja_no_se_descarta_por_hora():
    c = Constraints()
    assert (c.earliest_departure_hour, c.latest_arrival_hour) == (None, None)
    assert flight_rejection(DAWN, LEG, c, 1) is None


def test_con_franja_explicita_si():
    assert flight_rejection(DAWN, LEG, Constraints(earliest_departure_hour=6), 1) == "flight.departs_too_early"
    assert flight_rejection(DAWN, LEG, Constraints(latest_arrival_hour=23), 1) == "flight.arrives_too_late"


def test_el_golden_conserva_su_franja_y_un_pedido_viejo_sin_el_campo_sigue_valiendo():
    golden = FixtureProvider("orlando_nyc_5pax").trip_request()
    assert (golden.constraints.earliest_departure_hour, golden.constraints.latest_arrival_hour) == (6, 23)
    raw = golden.model_dump(mode="json")
    del raw["constraints"]["earliest_departure_hour"]
    assert TripRequest.model_validate(raw).constraints.earliest_departure_hour is None


def test_la_franja_oculta_escondia_un_viaje_mas_barato():
    """Mismas ofertas del caso golden: con la franja del fixture (6 a 23) el óptimo es el golden; sin franja, la
    madrugada deja un viaje más barato. Era lo que la persona veía como 'Sale antes de tu hora mínima'."""
    import asyncio

    from app.optimizer.skeletons import build_query_plan, generate_skeletons
    from app.optimizer.solver import optimize
    from app.providers.base import collect_offers
    from app.providers.fixture import get_fixture

    fx = get_fixture("orlando_nyc_5pax")
    golden = fx.trip_request()
    free = golden.model_copy(update={"constraints": golden.constraints.model_copy(
        update={"earliest_departure_hour": None, "latest_arrival_hour": None})})
    offers = asyncio.run(collect_offers(build_query_plan(golden, generate_skeletons(golden)), fx))
    assert optimize(golden, offers).itineraries[0].total_minor == 2008362
    assert optimize(free, offers).itineraries[0].total_minor == 1986862
