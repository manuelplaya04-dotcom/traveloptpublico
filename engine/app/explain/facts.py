"""Hechos del embudo: el único contexto que recibe el LLM.

Todo lo que el texto puede afirmar está acá, ya calculado y formateado por el motor: cuántas opciones descartó cada
regla y qué pasa si se afloja una restricción (lo calcula el optimizador de verdad sobre las ofertas ya guardadas, sin
pedir datos nuevos a ningún proveedor). No incluye nada que identifique a la persona: ni ids, ni fechas exactas, ni
presupuesto. En el tier gratuito de Gemini, Google puede usar lo que se envía para mejorar sus productos.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.domain.models import TripRequest
from app.domain.money import fmt

MAX_REJECTIONS = 6
MAX_RELAXATIONS = 3

# Qué descartó cada regla, en palabras de la persona (mismo sentido que el embudo de la web).
REASON_LABEL: dict[str, str] = {
    "flight.too_many_stops": "vuelos con más escalas que tu máximo",
    "flight.departs_too_early": "vuelos que salen antes de tu hora mínima",
    "flight.arrives_too_late": "vuelos que llegan después de tu hora máxima",
    "flight.insufficient_seats": "vuelos sin asientos para todo el grupo",
    "lodging.bathrooms": "alojamientos con menos baños que tu mínimo",
    "lodging.bedrooms": "alojamientos con menos dormitorios que tu mínimo",
    "lodging.capacity": "alojamientos sin lugar para todo el grupo",
    "lodging.min_nights": "alojamientos que piden más noches que las planificadas",
    "lodging.short_term_not_legal": "alquileres temporarios no legales en la ciudad",
    "lodging.no_kitchen": "alojamientos sin cocina",
    "lodging.kitchen_unknown": "alojamientos que no informan si tienen cocina",
    "lodging.no_unit_combination": "alojamientos sin una combinación de unidades que cumpla",
    "activity.weather_rain": "actividades al aire libre con lluvia fuerte probable",
    "activity.weather_heat": "actividades al aire libre con calor extremo",
}


class Relaxation(BaseModel):
    """Una restricción aflojada un paso y lo que calculó el optimizador con ese cambio."""
    model_config = ConfigDict(extra="forbid")
    setting: str
    current: str  # valores ya formateados: el LLM los copia, no los calcula
    proposed: str
    feasible: bool
    best_total: str | None = None


class RejectionFact(BaseModel):
    model_config = ConfigDict(extra="forbid")
    what: str
    count: int = Field(ge=1)


class FunnelFacts(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    destinations: list[str]
    travelers: int
    rejections: list[RejectionFact]
    impossible_date_options: int = Field(ge=0)  # combinaciones de fechas y noches sin viaje posible
    date_options: int = Field(ge=0)
    relaxations: list[Relaxation]


# ---------------------------------------------------------------- contrafactuales

# Regla de descarte -> restricción que la produce, cómo aflojarla un paso y cómo mostrar el valor.
@dataclass(frozen=True)
class _Lever:
    field: str
    setting: str
    step: Callable[[object], object | None]
    show: Callable[[object], str]


def _int_step(delta: int, lo: int, hi: int) -> Callable[[object], object | None]:
    def step(v: object) -> object | None:
        if not isinstance(v, int) or isinstance(v, bool):
            return None
        nxt = v + delta
        return nxt if lo <= nxt <= hi else None
    return step


def _rain_step(v: object) -> object | None:
    if not isinstance(v, (int, float)) or isinstance(v, bool) or v >= 1.0:
        return None
    return round(min(1.0, float(v) + 0.2), 2)


def _off(v: object) -> object | None:
    return False if v is True else None


def _hour(v: object) -> str:
    return f"{v}:00" if isinstance(v, int) else str(v)


def _pct(v: object) -> str:
    return f"{round(float(v) * 100)}%" if isinstance(v, (int, float)) else str(v)


def _yes_no(v: object) -> str:
    return "sí" if v is True else "no"


LEVERS: dict[str, _Lever] = {
    "flight.too_many_stops": _Lever(field="max_stops", setting="escalas máximas por tramo",
                                    step=_int_step(+1, 0, 3), show=str),
    "flight.arrives_too_late": _Lever(field="latest_arrival_hour", setting="hora máxima de llegada",
                                      step=_int_step(+2, 0, 23), show=_hour),
    "flight.departs_too_early": _Lever(field="earliest_departure_hour", setting="hora mínima de salida",
                                       step=_int_step(-2, 0, 23), show=_hour),
    "lodging.bathrooms": _Lever(field="min_bathrooms", setting="baños mínimos",
                                step=_int_step(-1, 0, 10), show=str),
    "lodging.bedrooms": _Lever(field="min_bedrooms", setting="dormitorios mínimos",
                               step=_int_step(-1, 0, 10), show=str),
    "lodging.no_kitchen": _Lever(field="require_kitchen", setting="exigir cocina", step=_off, show=_yes_no),
    "lodging.kitchen_unknown": _Lever(field="require_kitchen", setting="exigir cocina", step=_off, show=_yes_no),
    "activity.weather_rain": _Lever(field="max_heavy_rain_prob", setting="tolerancia a la lluvia",
                                    step=_rain_step, show=_pct),
}


def relaxed_requests(req: TripRequest, counts: dict[str, int]) -> list[tuple[_Lever, object, object, TripRequest]]:
    """Las restricciones a aflojar, de la que más descartó a la que menos (una por campo, hasta MAX_RELAXATIONS).
    Orden determinístico: cantidad descendente y, a igualdad, nombre de la regla."""
    out: list[tuple[_Lever, object, object, TripRequest]] = []
    seen: set[str] = set()
    for reason, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])):
        lever = LEVERS.get(reason)
        if lever is None or lever.field in seen:
            continue
        current = getattr(req.constraints, lever.field)
        proposed = lever.step(current)
        if proposed is None:
            continue
        seen.add(lever.field)
        relaxed = req.model_copy(update={"constraints": req.constraints.model_copy(update={lever.field: proposed})})
        out.append((lever, current, proposed, relaxed))
        if len(out) == MAX_RELAXATIONS:
            break
    return out


# ---------------------------------------------------------------- armado

def rejection_counts(diagnostics: object) -> dict[str, int]:
    """Cantidad de opciones descartadas por regla. Tolera un diagnóstico vacío o con forma inesperada (dato viejo o
    corrupto en la base): lo que no se entiende se ignora, nunca rompe."""
    rejections = diagnostics.get("rejections") if isinstance(diagnostics, dict) else None
    if not isinstance(rejections, dict):
        return {}
    return {k: len(v) for k, v in rejections.items() if isinstance(k, str) and isinstance(v, list) and v}


def build_facts(req: TripRequest, summary: dict, relaxations: list[Relaxation]) -> FunnelFacts:
    diagnostics = summary.get("diagnostics") if isinstance(summary, dict) else None
    counts = rejection_counts(diagnostics)
    infeasible = diagnostics.get("infeasible_skeletons") if isinstance(diagnostics, dict) else None
    stats = summary.get("stats") if isinstance(summary, dict) else None
    total = stats.get("skeletons_total") if isinstance(stats, dict) else None
    rejections = [
        RejectionFact(what=REASON_LABEL.get(reason, reason), count=n)
        for reason, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:MAX_REJECTIONS]
    ]
    return FunnelFacts(
        destinations=[c.name or c.code for c in req.cities],
        travelers=req.pax,
        rejections=rejections,
        impossible_date_options=len(infeasible) if isinstance(infeasible, dict) else 0,
        date_options=total if isinstance(total, int) and total >= 0 else 0,
        relaxations=relaxations,
    )


def relaxation_fact(lever: _Lever, current: object, proposed: object, best_total_minor: int | None) -> Relaxation:
    return Relaxation(
        setting=lever.setting, current=lever.show(current), proposed=lever.show(proposed),
        feasible=best_total_minor is not None,
        best_total=fmt(best_total_minor) if best_total_minor is not None else None,
    )
