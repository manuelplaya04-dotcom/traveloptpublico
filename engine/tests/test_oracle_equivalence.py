"""CP-SAT vs fuerza bruta: deben coincidir al centavo (caso fixture + instancias aleatorias)."""
import random
from datetime import date, timedelta

import pytest

from app.domain.models import ActivityOffer, Constraints, LodgingOffer, LodgingUnit, WeatherDay
from app.optimizer.activities import solve_activities
from app.optimizer.filters import Diagnostics
from app.optimizer.lodging import solve_lodging
from app.optimizer.oracle import solve_activities_brute, solve_lodging_brute
from app.optimizer.skeletons import Stay
from app.optimizer.solver import optimize


def _cost(x):
    return None if x is None else x.cost_minor


def test_full_case_cpsat_equals_brute(req, offers):
    a = optimize(req, offers, engine="cpsat")
    b = optimize(req, offers, engine="brute")
    assert [i.total_minor for i in a.itineraries] == [i.total_minor for i in b.itineraries]
    assert [i.skeleton.id for i in a.itineraries] == [i.skeleton.id for i in b.itineraries]
    assert a.diagnostics["infeasible_skeletons"] == b.diagnostics["infeasible_skeletons"]


def _random_lodging(rng: random.Random, stay: Stay) -> list[LodgingOffer]:
    offers = []
    for h in range(rng.randint(1, 4)):
        units = [
            LodgingUnit(
                unit_type=f"u{j}",
                capacity=rng.randint(1, 6),
                bedrooms=rng.randint(0, 3),
                bathrooms=rng.randint(0, 2),
                available=rng.randint(0, 3),
                base_total_minor=rng.randint(1, 900) * 100,
                fees_total_minor=rng.choice([0, 0, rng.randint(1, 99) * 100]),
            )
            for j in range(rng.randint(1, 3))
        ]
        offers.append(
            LodgingOffer(
                id=f"P{h}", provider="rnd", city=stay.city, name=f"P{h}",
                check_in=stay.check_in, check_out=stay.check_out, units=units,
                stay_fee_minor=rng.choice([0, rng.randint(1, 300) * 100]),
                tax_bps=rng.choice([0, 1250, 1350, 1475]),
            )
        )
    return offers


@pytest.mark.parametrize("seed", range(150))
def test_random_lodging(seed):
    rng = random.Random(seed)
    stay = Stay("X", date(2027, 1, 1), date(2027, 1, 1) + timedelta(days=rng.randint(1, 10)))
    c = Constraints(min_bathrooms=rng.randint(0, 3), min_bedrooms=rng.randint(0, 3))
    pax = rng.randint(1, 8)
    offers = _random_lodging(rng, stay)
    assert _cost(solve_lodging(stay, offers, c, pax, Diagnostics())) == _cost(
        solve_lodging_brute(stay, offers, c, pax, Diagnostics())
    )


@pytest.mark.parametrize("seed", range(150))
def test_random_activities(seed):
    rng = random.Random(seed)
    start = date(2027, 7, 1)
    stay = Stay("X", start, start + timedelta(days=rng.randint(2, 8)))
    keys = [f"k{i}" for i in range(rng.randint(1, 4))]
    slots = {k: rng.choice([1, 2]) for k in keys}
    outdoor = {k: rng.random() < 0.7 for k in keys}
    offers, weather = [], {}
    for i in range(stay.nights + 1):
        d = start + timedelta(days=i)
        weather[("X", d)] = WeatherDay(city="X", date=d, tmax_c=30, heavy_rain_prob=rng.random(), source="rnd")
        for k in keys:
            if rng.random() < 0.8:
                offers.append(
                    ActivityOffer(
                        id=f"{k}@{d}", provider="rnd", city="X", activity_key=k, name=k, date=d,
                        price_per_pax_minor=rng.randint(10, 300) * 100, outdoor=outdoor[k], slots=slots[k],
                    )
                )
    c = Constraints(
        max_heavy_rain_prob=rng.choice([0.3, 0.5, 0.8]),
        max_consecutive_full_days=rng.randint(1, 3),
        activity_free_travel_days=rng.random() < 0.5,
    )
    pax = rng.randint(1, 6)
    assert _cost(solve_activities(stay, keys, offers, weather, c, pax, Diagnostics())) == _cost(
        solve_activities_brute(stay, keys, offers, weather, c, pax, Diagnostics())
    )
