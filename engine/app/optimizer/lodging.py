"""Subproblema de alojamiento por estadía: cobertura entera de capacidad y baños (CP-SAT).

min  sum_h fee_h * p_h + sum_{h,u} cost_{h,u} * n_{h,u}
s.a. sum_h p_h = 1                                   (una sola propiedad: el grupo no se divide)
     0 <= n_{h,u} <= avail_{h,u} * p_h
     sum_u cap_{h,u}  * n_{h,u} >= pax          si p_h
     sum_u bath_{h,u} * n_{h,u} >= min_baños    si p_h
     sum_u bed_{h,u}  * n_{h,u} >= min_dorm     si p_h
"""
from __future__ import annotations

from dataclasses import dataclass

from ortools.sat.python import cp_model

from app.domain.models import Constraints, LodgingOffer
from app.optimizer.filters import Diagnostics, lodging_rejection, stay_fee_cost, unit_cost
from app.optimizer.skeletons import Stay

SOLVER_TIME_LIMIT_S = 5.0


@dataclass(frozen=True)
class LodgingChoice:
    offer: LodgingOffer
    units: tuple[tuple[int, int], ...]  # (índice de unidad en la oferta, cantidad)
    cost_minor: int
    optimal: bool


def new_solver() -> cp_model.CpSolver:
    s = cp_model.CpSolver()
    s.parameters.max_time_in_seconds = SOLVER_TIME_LIMIT_S
    s.parameters.num_workers = 1  # determinismo: misma entrada -> misma salida
    return s


def lodging_candidates(
    stay: Stay, offers: list[LodgingOffer], c: Constraints, pax: int, diag: Diagnostics
) -> list[LodgingOffer]:
    out = []
    for o in offers:
        if (o.city, o.check_in, o.check_out) != (stay.city, stay.check_in, stay.check_out):
            continue
        reason = lodging_rejection(o, stay, c, pax)
        if reason:
            diag.reject(reason, o.id)
            continue
        out.append(o)
    return sorted(out, key=lambda o: o.id)


def choice_cost(o: LodgingOffer, units: tuple[tuple[int, int], ...]) -> int:
    return stay_fee_cost(o) + sum(q * unit_cost(o, o.units[j]) for j, q in units)


def solve_lodging(
    stay: Stay, offers: list[LodgingOffer], c: Constraints, pax: int, diag: Diagnostics
) -> LodgingChoice | None:
    cands = lodging_candidates(stay, offers, c, pax, diag)
    if not cands:
        return None
    m = cp_model.CpModel()
    pick, qty, cost_terms = {}, {}, []
    for i, o in enumerate(cands):
        p = m.new_bool_var(f"p_{i}")
        pick[i] = p
        cost_terms.append(stay_fee_cost(o) * p)
        cap, bath, bed = [], [], []
        for j, u in enumerate(o.units):
            n = m.new_int_var(0, u.available, f"n_{i}_{j}")
            m.add(n <= u.available * p)
            qty[(i, j)] = n
            cost_terms.append(unit_cost(o, u) * n)
            cap.append(u.capacity * n)
            bath.append(u.bathrooms * n)
            bed.append(u.bedrooms * n)
        m.add(sum(cap) >= pax).only_enforce_if(p)
        m.add(sum(bath) >= c.min_bathrooms).only_enforce_if(p)
        m.add(sum(bed) >= c.min_bedrooms).only_enforce_if(p)
    m.add_exactly_one(pick.values())
    m.minimize(sum(cost_terms))

    solver = new_solver()
    status = solver.solve(m)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None
    for i, o in enumerate(cands):
        if solver.value(pick[i]):
            units = tuple(
                (j, solver.value(qty[(i, j)]))
                for j in range(len(o.units))
                if solver.value(qty[(i, j)]) > 0
            )
            return LodgingChoice(o, units, choice_cost(o, units), status == cp_model.OPTIMAL)
    return None


def lodging_options(stay: Stay, offers: list[LodgingOffer], c: Constraints, pax: int) -> list[dict]:
    """Todas las propiedades de la estadía para el dashboard por ciudad: la mejor combinación de unidades de cada
    una (mismo modelo que solve_lodging, restringido a esa oferta) o el motivo de descarte. Elegibles primero,
    por costo; las descartadas al final. No toca el embudo de la corrida."""
    out = []
    for o in offers:
        if (o.city, o.check_in, o.check_out) != (stay.city, stay.check_in, stay.check_out):
            continue
        reason = lodging_rejection(o, stay, c, pax)
        choice = None if reason else solve_lodging(stay, [o], c, pax, Diagnostics())
        if not reason and choice is None:
            reason = "lodging.no_unit_combination"
        out.append({
            "offer_id": o.id,
            "provider": o.provider,
            "name": o.name,
            "stars": o.stars,
            "rating": o.rating,
            "lat": o.lat,
            "lon": o.lon,
            "deeplink": o.deeplink,
            "amenities": o.amenities,
            "kitchen": o.kitchen,
            "photo_url": o.photo_url,
            "fetched_at": o.fetched_at.isoformat() if o.fetched_at else None,
            "rejection": reason,
            "cost_minor": choice.cost_minor if choice else None,
            "units": [{**o.units[j].model_dump(mode="json"), "qty": q} for j, q in choice.units] if choice else [],
        })
    return sorted(out, key=lambda x: (x["rejection"] is not None, x["cost_minor"] or 0, x["offer_id"]))
