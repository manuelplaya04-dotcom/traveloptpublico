"""Subproblema de actividades por estadía: asignación actividad -> día (CP-SAT).

Variables x_{k,o} = 1 si la actividad obligatoria k se hace con la oferta o (oferta = fecha).
min  SCALE * sum costo_{k,o} * x_{k,o}  +  sum desempate_{k,o} * x_{k,o}
s.a. sum_o x_{k,o} = 1                                     cada must-do exactamente una vez
     sum_{k,o: fecha=d} slots_k * x_{k,o} <= 2             capacidad diaria (2 medios días)
     sum_{d en ventana de M+1 días} full_d <= M            máx. M días completos seguidos
Las ofertas outdoor con clima fuera de umbral ya fueron eliminadas (restricción dura).
El desempate (lluvia esperada en ‰) nunca puede superar una unidad de costo.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date

from ortools.sat.python import cp_model

from app.domain.models import ActivityOffer, Constraints, WeatherDay
from app.optimizer.filters import Diagnostics, activity_rejection
from app.optimizer.lodging import new_solver
from app.optimizer.skeletons import Stay, usable_days

DAY_SLOTS = 2


@dataclass(frozen=True)
class ActivityPlan:
    items: tuple[ActivityOffer, ...]  # ordenadas por fecha
    cost_minor: int
    optimal: bool


def activity_options(
    stay: Stay,
    must_do: list[str],
    offers: list[ActivityOffer],
    weather: dict[tuple[str, date], WeatherDay],
    c: Constraints,
    diag: Diagnostics,
) -> dict[str, list[ActivityOffer]] | None:
    days = set(usable_days(stay, c))
    opts: dict[str, list[ActivityOffer]] = {k: [] for k in must_do}
    for a in offers:
        if a.city != stay.city or a.activity_key not in opts or a.date not in days:
            continue
        w = weather.get((a.city, a.date))
        if w is None and a.outdoor:
            diag.warnings.add(f"sin_clima:{a.city}:{a.date.isoformat()}")
        reason = activity_rejection(a, w, c)
        if reason:
            diag.reject(reason, a.id)
            continue
        opts[a.activity_key].append(a)
    if any(not v for v in opts.values()):
        return None
    return {k: sorted(v, key=lambda a: (a.date, a.id)) for k, v in opts.items()}


def plan_cost(items, pax: int) -> int:
    return sum(a.price_per_pax_minor * pax for a in items)


def solve_activities(
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

    m = cp_model.CpModel()
    x: dict[tuple[str, int], cp_model.IntVar] = {}
    slots_by_day, full_by_day = defaultdict(list), defaultdict(list)
    cost_terms, tie_terms = [], []
    for k, lst in opts.items():
        for i, a in enumerate(lst):
            v = m.new_bool_var(f"x_{k}_{i}")
            x[(k, i)] = v
            slots_by_day[a.date].append(a.slots * v)
            if a.slots == DAY_SLOTS:
                full_by_day[a.date].append(v)
            cost_terms.append(a.price_per_pax_minor * pax * v)
            w = weather.get((a.city, a.date))
            tie_terms.append(round(w.heavy_rain_prob * 1000) * v if w else 0)
        m.add_exactly_one(x[(k, i)] for i in range(len(lst)))
    for terms in slots_by_day.values():
        m.add(sum(terms) <= DAY_SLOTS)
    days = usable_days(stay, c)
    M = c.max_consecutive_full_days
    for s in range(len(days) - M):
        window = [v for d in days[s : s + M + 1] for v in full_by_day.get(d, [])]
        if window:
            m.add(sum(window) <= M)
    scale = 1000 * (len(must_do) + 1)
    m.minimize(scale * sum(cost_terms) + sum(tie_terms))

    solver = new_solver()
    status = solver.solve(m)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None
    chosen = sorted(
        (opts[k][i] for (k, i), v in x.items() if solver.value(v)), key=lambda a: (a.date, a.id)
    )
    return ActivityPlan(tuple(chosen), plan_cost(chosen, pax), status == cp_model.OPTIMAL)
