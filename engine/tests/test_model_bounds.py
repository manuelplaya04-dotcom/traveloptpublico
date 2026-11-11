"""Cotas del modelo de entrada (anti-DoS por combinatoria) y deeplinks solo https."""
import pytest
from pydantic import ValidationError

from app.domain.models import ActivityOffer, FlightOffer, LodgingOffer, TransportQuote, TripRequest
from app.providers.fixture import FixtureProvider


def _base() -> dict:
    return FixtureProvider("orlando_nyc_5pax").trip_request().model_dump(mode="json")


def test_fixture_request_is_within_bounds():
    TripRequest.model_validate(_base())


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(case_key="../x"),
        lambda d: d.update(case_key="A" * 10),
        lambda d: d.update(origin_airports=["eze"]),
        lambda d: d.update(origin_airports=["EZE"] * 6),
        lambda d: d.update(total_nights_max=61),
        lambda d: d.update(budget_minor=10**10 + 1),
        lambda d: d["cities"][0].update(code="orl"),
        lambda d: d["cities"][0].update(airports=["MCOX"]),
        lambda d: d["cities"][0].update(lat=91),
        lambda d: d["cities"][0].update(lon=-181),
        lambda d: d["cities"][0].update(max_nights=22),
        lambda d: d["cities"][0].update(must_do=["a b"]),
        lambda d: d["cities"][0].update(must_do=["MK"] * 11),
        lambda d: d.update(first_checkin_to="2027-09-30"),  # ventana de 84 días
    ],
)
def test_out_of_bounds_request_is_rejected(mutate):
    d = _base()
    mutate(d)
    with pytest.raises(ValidationError):
        TripRequest.model_validate(d)


def test_combinatorial_explosion_is_rejected():
    d = _base()
    d["fixed_order"] = False
    d["first_checkin_to"] = "2027-08-07"  # 31 días
    base_city = d["cities"][0]
    d["cities"] = [{**base_city, "code": code, "min_nights": 1, "max_nights": 21} for code in ("AAA", "BBB", "CCC", "DDD")]
    with pytest.raises(ValidationError, match="excesivas"):
        TripRequest.model_validate(d)


_FLIGHT = dict(id="f", provider="p", origin="EZE", destination="MCO", depart_at="2027-07-08T10:00:00",
               arrive_at="2027-07-08T20:00:00", stops=0, carrier="AA", price_per_pax_minor=1, seats_available=9)
_UNIT = dict(unit_type="u", capacity=2, bedrooms=1, bathrooms=1, available=1, base_total_minor=1)
_LODGING = dict(id="l", provider="p", city="ORL", name="n", check_in="2027-07-08", check_out="2027-07-09", units=[_UNIT])
_ACTIVITY = dict(id="a", provider="p", city="ORL", activity_key="MK", name="n", date="2027-07-08",
                 price_per_pax_minor=1, outdoor=True)
_TRANSPORT = dict(id="t", provider="p", city="ORL", mode="car_rental")
_OFFERS = [(FlightOffer, _FLIGHT), (LodgingOffer, _LODGING), (ActivityOffer, _ACTIVITY), (TransportQuote, _TRANSPORT)]


@pytest.mark.parametrize("cls,base", _OFFERS)
@pytest.mark.parametrize(
    "bad",
    ["javascript:alert(1)", "data:text/html,<script>1</script>", "http://example.com/x", "https://", "//evil.com",
     "https://user:pw@example.com/x", "ftp://example.com", "JAVASCRIPT:alert(1)"],
)
def test_deeplink_rejects_non_https(cls, base, bad):
    with pytest.raises(ValidationError):
        cls(**base, deeplink=bad)


@pytest.mark.parametrize("cls,base", _OFFERS)
def test_deeplink_accepts_https_and_none(cls, base):
    assert cls(**base, deeplink="https://example.com/book?id=1").deeplink == "https://example.com/book?id=1"
    assert cls(**base, deeplink=None).deeplink is None
    assert cls(**base).deeplink is None
