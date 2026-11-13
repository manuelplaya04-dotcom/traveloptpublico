"""Orquestador matemático: esqueletos -> subproblemas separables -> ranking exacto.

Dado un esqueleto, el costo total se separa en bloques independientes (vuelo por tramo;
alojamiento, actividades y transporte por estadía). Resolver cada bloque a optimalidad y
sumar da el ÓPTIMO GLOBAL exacto del modelo completo: es una descomposición, no una
heurística. Los bloques que se repiten entre esqueletos se resuelven una sola vez (memo).
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from time import perf_counter
from typing import Literal

from app.domain.models import FlightOffer, OfferSet, TransportQuote, TripRequest
from app.optimizer.activities import ActivityPlan, solve_activities
from app.optimizer.filters import (
    Diagnostics,
    flight_cost,
    flight_rejection,
    leg_matches,
    transport_cost,
)
from app.optimizer.lodging import LodgingChoice, solve_lodging
from app.optimizer.skeletons import Leg, Skeleton, Stay, generate_skeletons

Engine = Literal["cpsat", "brute"]


@dataclass(frozen=True)
class ChosenFlight:
    leg_index: int
    offer: FlightOffer
    cost_minor: int


@dataclass(frozen=True)
class StayPlan:
    stay: Stay
    lodging: LodgingChoice | None  # None: alojamiento no pedido (la persona ya lo tiene)
    activities: ActivityPlan
    transport: TransportQuote | None
    transport_cost_minor: int


@dataclass
class Itinerary:
    rank: int
    skeleton: Skeleton
    flights: list[ChosenFlight]
    stays: list[StayPlan]
    total_minor: int
    within_budget: bool


NO_ACTIVITIES = ActivityPlan((), 0, True)  # actividades no pedidas: el bloque no existe en el modelo

Status = Literal["ok", "over_budget", "infeasible"]


@dataclass
class OptimizationResult:
    status: Status
    itineraries: list[Itinerary]
    budget_gap_minor: int
    diagnostics: dict
    stats: dict


def best_flight(leg: Leg, flights: list[FlightOffer], c, pax: int, diag: Diagnostics):
    best = None
    for f in flights:
        if not leg_matches(f, leg):
            continue
        reason = flight_rejection(f, leg, c, pax)
        if reason:
            diag.reject(reason, f.id)
            continue
        key = (flight_cost(f, c, pax), f.depart_at, f.id)
        if best is None or key < best[0]:
            best = (key, f)
    return None if best is None else (best[1], best[0][0])


def optimize(req: TripRequest, offers: OfferSet, engine: Engine = "cpsat",
             degraded: frozenset[str] = frozenset()) -> OptimizationResult:
    """`degraded`: tipos no críticos que no se pudieron extraer (clima, actividades). Sin clima, las actividades al aire
    libre se mantienen sin verificar; sin actividades, el itinerario sale sin ellas. Ambos casos quedan en warnings."""
    from app.optimizer import oracle

    solve_l = solve_lodging if engine == "cpsat" else oracle.solve_lodging_brute
    solve_a = solve_activities if engine == "cpsat" else oracle.solve_activities_brute
    t0 = perf_counter()
    c, pax, on = req.constraints, req.pax, req.services
    diag = Diagnostics()
    weather = {(w.city, w.date): w for w in offers.weather}
    # Índices por clave de consulta: cada bloque recibe solo sus ofertas (mismo orden relativo que la lista original).
    flights_by_key: dict = defaultdict(dict)  # (origen, destino, fecha de salida) -> {posición: oferta}
    for pos, f in enumerate(offers.flights):
        flights_by_key[(f.origin, f.destination, f.depart_at.date())][pos] = f
    lodging_by_stay: dict = defaultdict(list)
    for o in offers.lodging:
        lodging_by_stay[(o.city, o.check_in, o.check_out)].append(o)
    activities_by_city: dict = defaultdict(list)
    for a in offers.activities:
        activities_by_city[a.city].append(a)
    transport: dict[str, TransportQuote] = {}
    for q in sorted(offers.transport, key=lambda q: q.id):
        if q.mode == "transfers" and not on.flights:  # traslados al aeropuerto: solo si cotizamos los vuelos
            continue
        transport.setdefault(q.city, q)
    must_do = {p.code: p.must_do for p in req.cities}
    if "activities" in degraded:
        must_do = {code: [] for code in must_do}
        diag.warnings.add("actividades_no_disponibles")
    if "weather" in degraded:
        diag.warnings.add("clima_no_disponible")

    skeletons = generate_skeletons(req)
    flight_memo: dict = {}
    lodging_memo: dict = {}
    act_memo: dict = {}
    feasible: list[Itinerary] = []
    for s in skeletons:
        reason = None
        flights: list[ChosenFlight] = []
        for i, leg in enumerate(s.legs if on.flights else ()):
            if leg not in flight_memo:
                found = {
                    pos: f
                    for o in leg.origin_airports
                    for d in leg.dest_airports
                    for day in leg.depart_dates
                    for pos, f in flights_by_key.get((o, d, day), {}).items()
                }
                flight_memo[leg] = best_flight(leg, [found[pos] for pos in sorted(found)], c, pax, diag)
            if flight_memo[leg] is None:
                reason = f"sin_vuelo:tramo_{i}"
                break
            offer, cost = flight_memo[leg]
            flights.append(ChosenFlight(i, offer, cost))
        plans: list[StayPlan] = []
        for st in s.stays if reason is None else ():
            lodging: LodgingChoice | None = None
            if on.lodging:
                if st not in lodging_memo:
                    lodging_memo[st] = solve_l(st, lodging_by_stay.get((st.city, st.check_in, st.check_out), []),
                                               c, pax, diag)
                lodging = lodging_memo[st]
                if lodging is None:
                    reason = f"sin_alojamiento:{st.city}"
                    break
            acts = NO_ACTIVITIES
            if on.activities:
                if st not in act_memo:
                    act_memo[st] = solve_a(st, must_do[st.city], activities_by_city.get(st.city, []), weather, c, pax,
                                           diag)
                acts = act_memo[st]
                if acts is None:
                    reason = f"actividades_infactibles:{st.city}"
                    break
            quote = transport.get(st.city)
            if quote is None:
                diag.warnings.add(f"sin_transporte:{st.city}")
            plans.append(StayPlan(st, lodging, acts, quote, transport_cost(quote, st) if quote else 0))
        if reason:
            diag.infeasible_skeletons[s.id] = reason
            continue
        total = sum(f.cost_minor for f in flights) + sum(
            (p.lodging.cost_minor if p.lodging else 0) + p.activities.cost_minor + p.transport_cost_minor for p in plans
        )
        feasible.append(Itinerary(0, s, flights, plans, total, total <= req.budget_minor))

    feasible.sort(key=lambda it: (it.total_minor, it.skeleton.id))
    top = feasible[: req.top_n]
    for rank, it in enumerate(top, start=1):
        it.rank = rank
    if not top:
        status: Status
        status, gap = "infeasible", 0
    elif top[0].within_budget:
        status, gap = "ok", 0
    else:
        status, gap = "over_budget", top[0].total_minor - req.budget_minor

    subproblems = [v for v in (*lodging_memo.values(), *act_memo.values()) if v is not None]
    stats = {
        "engine": engine,
        "skeletons_total": len(skeletons),
        "skeletons_feasible": len(feasible),
        "unique_legs": len(flight_memo),
        "unique_stays": len(lodging_memo),
        "all_subproblems_optimal": all(v.optimal for v in subproblems),
        "elapsed_ms": round((perf_counter() - t0) * 1000, 1),
    }
    return OptimizationResult(status, top, gap, diag.summary(), stats)
