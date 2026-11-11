"""Zonas horarias de aeropuertos y duración real de vuelos que cruzan husos, medianoche y la línea de cambio de fecha."""
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest

from app.domain.timezones import _table, airport_tz, flight_times, to_utc
from app.providers.flights import normalize
from app.services import alerts


def dt(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%d %H:%M")


def itinerary(origin: str, depart: str, destination: str, arrive: str) -> dict:
    return {"price": 500, "layovers": [], "flights": [{
        "flight_number": "AA 100",
        "departure_airport": {"id": origin, "time": depart},
        "arrival_airport": {"id": destination, "time": arrive},
    }]}


def test_la_tabla_es_valida_y_cubre_el_catalogo():
    table = _table()
    assert len(table) > 7000
    for name in set(table.values()):
        ZoneInfo(name)  # toda zona existe en la base IANA
    for code in ("EZE", "MCO", "JFK", "LGA", "EWR", "MIA", "PHL", "BOS", "IAD", "DCA", "LAX", "MAD", "NRT", "SYD"):
        assert code in table


def test_aeropuerto_desconocido_no_inventa_zona():
    assert airport_tz("ZZZ") is None
    assert to_utc(dt("2027-07-08 09:00"), "ZZZ") is None
    assert flight_times("ZZZ", dt("2027-07-08 09:00"), "JFK", dt("2027-07-08 12:00")).duration_min is None


@pytest.mark.parametrize(("origin", "depart", "destination", "arrive", "minutes"), [
    # mismo huso
    ("MCO", "2027-07-16 09:10", "LGA", "2027-07-16 11:45", 155),
    # costa oeste a este: 5 h 20 de vuelo, se pierden 3 h de reloj
    ("LAX", "2027-07-10 08:00", "JFK", "2027-07-10 16:20", 320),
    # este a oeste: el reloj casi no avanza
    ("JFK", "2027-07-10 18:00", "LAX", "2027-07-10 21:10", 370),
    # cruza medianoche
    ("EZE", "2027-07-08 22:30", "MCO", "2027-07-09 07:10", 580),
    # Tokio a Los Ángeles: llega "antes" de salir en hora local, pero duró casi 10 h
    ("NRT", "2027-07-10 17:00", "LAX", "2027-07-10 11:00", 600),
    # Los Ángeles a Sídney: salta un día entero del calendario
    ("LAX", "2027-07-10 22:00", "SYD", "2027-07-12 08:30", 1050),
])
def test_duracion_real_en_utc(origin, depart, destination, arrive, minutes):
    assert flight_times(origin, dt(depart), destination, dt(arrive)).duration_min == minutes


def test_cambio_de_hora_se_refleja_en_la_duracion():
    # 14/03/2027: EE.UU. adelanta el reloj a las 02:00. JFK -> BOS sale antes y llega después: 1 h menos real.
    assert flight_times("JFK", dt("2027-03-14 01:00"), "BOS", dt("2027-03-14 04:00")).duration_min == 120


def test_utc_exacto():
    assert to_utc(dt("2027-07-08 09:00"), "EZE") == datetime(2027, 7, 8, 12, 0, tzinfo=UTC)


def test_adapter_guarda_local_y_utc():
    o = normalize(itinerary("NRT", "2027-07-10 17:00", "LAX", "2027-07-10 11:00"), "p", None)
    assert o is not None
    assert o.depart_at == dt("2027-07-10 17:00") and o.arrive_at == dt("2027-07-10 11:00")  # local, sin tocar
    assert o.depart_utc == datetime(2027, 7, 10, 8, 0, tzinfo=UTC)
    assert o.arrive_utc == datetime(2027, 7, 10, 18, 0, tzinfo=UTC)
    assert o.duration_min == 600


@pytest.mark.parametrize(("depart", "arrive"), [
    ("2027-07-10 18:00", "2027-07-10 17:00"),  # mismo huso, llega antes de salir
    ("2027-07-10 18:00", "2027-07-10 18:00"),  # duración cero
])
def test_vuelo_ilogico_se_descarta_y_se_avisa(depart, arrive):
    before = alerts.counts().get("flight_illogical_duration", 0)
    assert normalize(itinerary("MCO", depart, "JFK", arrive), "p", None) is None
    assert alerts.counts()["flight_illogical_duration"] == before + 1


def test_sin_zona_no_se_descarta_por_duracion():
    o = normalize(itinerary("ZZZ", "2027-07-10 18:00", "JFK", "2027-07-10 17:00"), "p", None)
    assert o is not None and o.duration_min is None and o.depart_utc is None
