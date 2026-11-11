"""Oráculo de fuerza bruta: misma semántica que los modelos CP-SAT, enumerando TODO.

Uso exclusivo en tests y checkpoints (instancias chicas). Nunca en producción.
"""
from __future__ import annotations

from collections import Counter
from datetime import date
from itertools import product

from app.domain.models import ActivityOffer, Constraints, LodgingOffer, WeatherDay
from app.optimizer.activities import DAY_SLOTS, ActivityPlan, activity_options, plan_cost
from app.optimizer.filters import Diagnostics
from app.optimizer.lodging import LodgingChoice, choice_cost, lodging_candidates
from app.optimizer.skeletons import Stay, usable_days


def solve_lodging_brute(
    stay: Stay, offers: list[LodgingOffer], c: Constraints, pax: int, diag: Diagnostics
) -> LodgingChoice | None:
    best: LodgingChoice | None = None
    for o in lodging_candidates(stay, offers, c, pax, diag):
        for combo in product(*(range(u.available + 1) for u in o.units)):
            cap = sum(q * u.capacity for q, u in zip(combo, o.units))
            bath = sum(q * u.bathrooms for q, u in zip(combo, o.units))
            bed = sum(q * u.bedrooms for q, u in zip(combo, o.units))
            if cap < pax or bath < c.min_bathrooms or bed < c.min_bedrooms:
                continue
            units = tuple((j, q) for j, q in enumerate(combo) if q > 0)
            cost = choice_cost(o, units)
            if best is None or (cost, o.id) < (best.cost_minor, best.offer.id):
                best = LodgingChoice(o, units, cost, True)
    return best


def max_run(days, full: Counter) -> int:
    run = best = 0
    for d in days:
        run = run + 1 if full[d] else 0
        best = max(best, run)
    return best


def solve_activities_brute(
    stay: Stay,
    must_do: list[str],
    offers: list[ActivityOffer],
    weather: dict[tuple[str, date], WeatherDay],
    c: Constraints,
    pax: int,
    diag: Diagnostics,
) -> ActivityPlan | None:
    if not must_do:
        return ActivityPlan((), 0, True)
    opts = activity_options(stay, must_do, offers, weather, c, diag)
    if opts is None:
        return None
    days = usable_days(stay, c)
    best: ActivityPlan | None = None
    for combo in product(*(opts[k] for k in must_do)):
        slots: Counter[date] = Counter()
        full: Counter[date] = Counter()
        for a in combo:
            slots[a.date] += a.slots
            full[a.date] += a.slots == DAY_SLOTS
        if max(slots.values()) > DAY_SLOTS:
            continue
        if max_run(days, full) > c.max_consecutive_full_days:
            continue
        cost = plan_cost(combo, pax)
        if best is None or cost < best.cost_minor:
            items = tuple(sorted(combo, key=lambda a: (a.date, a.id)))
            best = ActivityPlan(items, cost, True)
    return best
