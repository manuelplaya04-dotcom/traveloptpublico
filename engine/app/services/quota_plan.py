"""Presupuesto de búsquedas de SerpApi por corrida: la cuota (250/mes, vuelos + hoteles) no admite planes grandes.

Google Flights y Google Hotels cotizan UNA fecha (o un par check-in/check-out) por búsqueda: no hay rangos. Lo que se
puede achicar es el espacio de búsqueda. Antes de extraer se cuenta cuántas búsquedas haría falta pagar (solo las que
NO están frescas en caché: lo cacheado es gratis) y, si superan el presupuesto, se recorta en este orden hasta entrar:

1. ``flex``: solo la fecha de ida elegida (sin los días de flexibilidad).
2. ``overnight``: sin la opción de salir la noche anterior.
3. ``rentals``: solo hoteles (sin la búsqueda extra de alquileres para grupos).

Cada recorte queda en ``summary.quota_narrowed`` y la web lo explica. Las restricciones duras no se tocan: se buscan
menos combinaciones, no se aceptan opciones que no cumplan. Extracción y optimizador usan la misma solicitud efectiva
(``effective_request``), así el embudo nunca culpa a "sin vuelos" de una fecha que no se consultó.
"""
from __future__ import annotations

from typing import Any

from app.domain.models import TripRequest

STEPS: tuple[str, ...] = ("flex", "overnight", "rentals")


def narrow(req: TripRequest, steps: list[str] | tuple[str, ...]) -> TripRequest:
    if not steps:
        return req
    update: dict[str, Any] = {}
    if "flex" in steps:
        update["first_checkin_to"] = req.first_checkin_from
    if "overnight" in steps:
        update["constraints"] = req.constraints.model_copy(update={"allow_overnight_outbound": False})
    return req.model_copy(update=update) if update else req


def narrowed_steps(summary: dict | None) -> list[str]:
    return [s for s in (summary or {}).get("quota_narrowed", []) if s in STEPS]


def effective_request(req: TripRequest, summary: dict | None) -> TripRequest:
    """La solicitud que realmente se busca y optimiza (la original, con los recortes de cuota aplicados)."""
    return narrow(req, narrowed_steps(summary))
