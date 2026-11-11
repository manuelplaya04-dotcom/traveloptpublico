"""Etapa 1 del motor: enumeración exhaustiva de esqueletos y plan mínimo de consultas.

Un esqueleto fija: orden de ciudades, fecha del primer check-in y noches por ciudad.
Con eso quedan determinados los tramos aéreos (Leg) y las estadías (Stay).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache
from itertools import permutations, product

from app.domain.models import Constraints, TripRequest


@dataclass(frozen=True)
class Stay:
    city: str
    check_in: date
    check_out: date

    @property
    def nights(self) -> int:
        return (self.check_out - self.check_in).days


@dataclass(frozen=True)
class Leg:
    origin_airports: tuple[str, ...]
    dest_airports: tuple[str, ...]
    depart_dates: tuple[date, ...]  # fechas de salida admitidas
    arrive_on: date | None  # debe llegar ese día (check-in); None = regreso a casa


@dataclass(frozen=True)
class Skeleton:
    id: str
    order: tuple[str, ...]
    first_checkin: date
    nights: tuple[int, ...]
    legs: tuple[Leg, ...]
    stays: tuple[Stay, ...]


@dataclass(frozen=True)
class FlightQuery:
    origins: tuple[str, ...]
    destinations: tuple[str, ...]
    date: date


@dataclass(frozen=True)
class QueryPlan:
    flights: tuple[FlightQuery, ...]
    stays: tuple[Stay, ...]
    city_days: tuple[tuple[str, date], ...]  # para actividades y clima
    cities: tuple[str, ...]


def _days(a: date, b: date):
    for i in range((b - a).days + 1):
        yield a + timedelta(days=i)


def usable_days(stay: Stay, c: Constraints) -> list[date]:
    """Días calendario de la estadía en los que se pueden programar actividades."""
    if c.activity_free_travel_days:
        return [stay.check_in + timedelta(days=i) for i in range(1, stay.nights)]
    return [stay.check_in + timedelta(days=i) for i in range(stay.nights + 1)]


def generate_skeletons(req: TripRequest) -> list[Skeleton]:
    by_code = {c.code: c for c in req.cities}
    orders = [tuple(by_code)] if req.fixed_order else list(permutations(by_code))
    home = tuple(req.origin_airports)
    out: list[Skeleton] = []
    for start in _days(req.first_checkin_from, req.first_checkin_to):
        for order in orders:
            plans = [by_code[code] for code in order]
            for nights in product(*(range(p.min_nights, p.max_nights + 1) for p in plans)):
                if not req.total_nights_min <= sum(nights) <= req.total_nights_max:
                    continue
                stays: list[Stay] = []
                cursor = start
                for p, n in zip(plans, nights):
                    stays.append(Stay(p.code, cursor, cursor + timedelta(days=n)))
                    cursor += timedelta(days=n)
                first = stays[0]
                outbound_dates = (
                    (first.check_in - timedelta(days=1), first.check_in)
                    if req.constraints.allow_overnight_outbound
                    else (first.check_in,)
                )
                legs = [Leg(home, tuple(plans[0].airports), outbound_dates, first.check_in)]
                for i in range(1, len(stays)):
                    legs.append(
                        Leg(
                            tuple(plans[i - 1].airports),
                            tuple(plans[i].airports),
                            (stays[i].check_in,),
                            stays[i].check_in,
                        )
                    )
                legs.append(Leg(tuple(plans[-1].airports), home, (stays[-1].check_out,), None))
                sid = f"{'-'.join(order)}|{start.isoformat()}|{'-'.join(map(str, nights))}"
                out.append(Skeleton(sid, order, start, nights, tuple(legs), tuple(stays)))
    return out


def build_query_plan(req: TripRequest, skeletons: list[Skeleton]) -> QueryPlan:
    """Conjunto MÍNIMO de consultas externas que cubre todos los esqueletos (deduplicado)."""
    flights = {
        FlightQuery(leg.origin_airports, leg.dest_airports, d)
        for s in skeletons
        for leg in s.legs
        for d in leg.depart_dates
    }
    stays = {st for s in skeletons for st in s.stays}
    city_days = {(st.city, d) for st in stays for d in usable_days(st, req.constraints)}
    return QueryPlan(
        flights=tuple(sorted(flights, key=lambda q: (q.date, q.origins, q.destinations))),
        stays=tuple(sorted(stays, key=lambda st: (st.city, st.check_in, st.check_out))),
        city_days=tuple(sorted(city_days)),
        cities=tuple(c.code for c in req.cities),
    )


@lru_cache(maxsize=32)
def _plan_for_json(request_json: str) -> QueryPlan:
    req = TripRequest.model_validate_json(request_json)
    return build_query_plan(req, generate_skeletons(req))


def plan_for(req: TripRequest) -> QueryPlan:
    """Plan de consultas de una solicitud, cacheado (el plan depende solo de la solicitud y es inmutable)."""
    return _plan_for_json(req.model_dump_json())
