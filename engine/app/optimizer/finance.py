"""Calculadora financiera: desglose línea por línea, exacto al centavo.

Usa las MISMAS funciones de dinero que el solver; al final concilia contra el total del
itinerario y falla ruidosamente si difiere en 1 centavo.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.domain.models import TripRequest
from app.domain.money import apply_bps, split_evenly
from app.optimizer.filters import flight_extra_bags, transport_base
from app.optimizer.solver import Itinerary

Category = Literal["vuelos", "alojamiento", "actividades", "transporte"]


@dataclass(frozen=True)
class Line:
    category: Category
    description: str
    quantity: int
    unit_minor: int
    subtotal_minor: int
    tax_minor: int
    total_minor: int
    ref: str
    deeplink: str | None


@dataclass
class Breakdown:
    currency: str
    lines: list[Line]
    by_category: dict[str, int]
    total_minor: int
    per_pax_minor: list[int]


class ReconciliationError(AssertionError):
    pass


def _line(cat, desc, qty, unit, ref, link, tax_bps: int = 0) -> Line:
    sub = qty * unit
    tax = qty * apply_bps(unit, tax_bps)
    return Line(cat, desc, qty, unit, sub, tax, sub + tax, ref, link)


def build_breakdown(it: Itinerary, req: TripRequest) -> Breakdown:
    c, pax = req.constraints, req.pax
    lines: list[Line] = []
    for cf in it.flights:
        f = cf.offer
        route = f"{f.origin}→{f.destination} {f.depart_at:%d/%m %H:%M} · {f.carrier} · {f.stops} esc."
        lines.append(_line("vuelos", f"Tarifa {route}", pax, f.price_per_pax_minor, f.id, f.deeplink))
        extra = flight_extra_bags(f, c) * pax
        if extra and f.bag_fee_minor:
            lines.append(_line("vuelos", f"Valijas {route}", extra, f.bag_fee_minor, f.id, f.deeplink))

    for sp in it.stays:
        o, nights = sp.lodging.offer, sp.stay.nights

        def lodging_line(desc: str, qty: int, unit: int, o=o) -> Line:
            return _line("alojamiento", desc, qty, unit, o.id, o.deeplink, o.tax_bps)

        for j, qty in sp.lodging.units:
            u = o.units[j]
            lines.append(lodging_line(f"{o.name} · {u.unit_type} · {nights} noches", qty, u.base_total_minor))
            if u.fees_total_minor:
                lines.append(lodging_line(f"Resort/facility fee · {u.unit_type}", qty, u.fees_total_minor))
        if o.stay_fee_minor:
            lines.append(lodging_line(f"Limpieza / cargo por reserva · {o.name}", 1, o.stay_fee_minor))
        for a in sp.activities.items:
            lines.append(_line("actividades", f"{a.name} · {a.date:%d/%m}", pax, a.price_per_pax_minor, a.id, a.deeplink))
        if sp.transport:
            q = sp.transport
            base = transport_base(q, sp.stay)
            label = "Alquiler de auto" if q.mode == "car_rental" else "Traslados"
            lines.append(_line("transporte", f"{label} · {sp.stay.city}", 1, base, q.id, q.deeplink, q.tax_bps))

    by_category: dict[str, int] = {}
    for ln in lines:
        by_category[ln.category] = by_category.get(ln.category, 0) + ln.total_minor
    total = sum(ln.total_minor for ln in lines)
    if total != it.total_minor:
        raise ReconciliationError(f"desglose {total} != solver {it.total_minor}")
    return Breakdown(req.currency, lines, by_category, total, split_evenly(total, pax))
