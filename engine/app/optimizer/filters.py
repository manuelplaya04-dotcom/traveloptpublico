"""Filtros de factibilidad (restricciones duras) y costos unitarios.

Cada filtro devuelve None si la oferta es factible o un código de motivo si se descarta.
Los motivos alimentan el "embudo de factibilidad" que se muestra al usuario.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import time

from app.domain.models import (
    ActivityOffer,
    Constraints,
    FlightOffer,
    LodgingOffer,
    LodgingUnit,
    TransportQuote,
    WeatherDay,
)
from app.domain.money import with_tax
from app.optimizer.skeletons import Leg, Stay


@dataclass
class Diagnostics:
    rejections: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))
    infeasible_skeletons: dict[str, str] = field(default_factory=dict)
    warnings: set[str] = field(default_factory=set)

    def reject(self, reason: str, offer_id: str) -> None:
        self.rejections[reason].add(offer_id)

    def summary(self) -> dict:
        return {
            "rejections": {k: sorted(v) for k, v in sorted(self.rejections.items())},
            "infeasible_skeletons": dict(sorted(self.infeasible_skeletons.items())),
            "warnings": sorted(self.warnings),
        }


# ---------------------------------------------------------------- vuelos


def leg_matches(f: FlightOffer, leg: Leg) -> bool:
    return (
        f.origin in leg.origin_airports
        and f.destination in leg.dest_airports
        and f.depart_at.date() in leg.depart_dates
        and (leg.arrive_on is None or f.arrive_at.date() == leg.arrive_on)
    )


def flight_rejection(f: FlightOffer, leg: Leg, c: Constraints, pax: int) -> str | None:
    if f.stops > c.max_stops:
        return "flight.too_many_stops"
    if f.depart_at.time() < time(c.earliest_departure_hour):
        return "flight.departs_too_early"
    if leg.arrive_on is not None and f.arrive_at.time() > time(c.latest_arrival_hour):
        return "flight.arrives_too_late"
    if f.seats_available < pax:
        return "flight.insufficient_seats"
    return None


def flight_extra_bags(f: FlightOffer, c: Constraints) -> int:
    return max(0, c.checked_bags_per_pax - f.included_bags)


def flight_cost(f: FlightOffer, c: Constraints, pax: int) -> int:
    return pax * (f.price_per_pax_minor + flight_extra_bags(f, c) * f.bag_fee_minor)


# ---------------------------------------------------------------- alojamiento


def lodging_rejection(o: LodgingOffer, stay: Stay, c: Constraints, pax: int) -> str | None:
    if not o.short_term_legal:
        return "lodging.short_term_not_legal"
    if stay.nights < o.min_nights:
        return "lodging.min_nights"
    if sum(u.capacity * u.available for u in o.units) < pax:
        return "lodging.capacity"
    if sum(u.bathrooms * u.available for u in o.units) < c.min_bathrooms:
        return "lodging.bathrooms"
    if sum(u.bedrooms * u.available for u in o.units) < c.min_bedrooms:
        return "lodging.bedrooms"
    if c.require_kitchen and o.kitchen is not True:
        return "lodging.no_kitchen" if o.kitchen is False else "lodging.kitchen_unknown"
    return None


def unit_cost(o: LodgingOffer, u: LodgingUnit) -> int:
    """Costo final de UNA unidad por toda la estadía (impuesto redondeado por línea)."""
    return with_tax(u.base_total_minor, o.tax_bps) + with_tax(u.fees_total_minor, o.tax_bps)


def stay_fee_cost(o: LodgingOffer) -> int:
    return with_tax(o.stay_fee_minor, o.tax_bps)


# ---------------------------------------------------------------- actividades


def activity_rejection(a: ActivityOffer, w: WeatherDay | None, c: Constraints) -> str | None:
    if not a.outdoor or w is None:
        return None
    if w.heavy_rain_prob > c.max_heavy_rain_prob:
        return "activity.weather_rain"
    if w.tmax_c > c.max_tmax_c:
        return "activity.weather_heat"
    return None


# ---------------------------------------------------------------- transporte


def transport_base(q: TransportQuote, stay: Stay) -> int:
    return q.per_day_minor * stay.nights + q.per_trip_minor * q.trips + q.fixed_minor


def transport_cost(q: TransportQuote, stay: Stay) -> int:
    return with_tax(transport_base(q, stay), q.tax_bps)
