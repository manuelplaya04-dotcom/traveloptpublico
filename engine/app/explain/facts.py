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

from app.domain.legal import LegalRules
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


class LegalFact(BaseModel):
    """Una norma local que descartó alquileres temporarios de la búsqueda."""
    model_config = ConfigDict(extra="forbid")
    city: str
    rule: str
    source: Literal["oficial", "secundaria", "no_verificada"]


Module = Literal["vuelos", "alojamiento", "actividades"]
MODULES: tuple[Module, ...] = ("vuelos", "alojamiento", "actividades")


def quoted_modules(req: TripRequest) -> list[Module]:
    """Módulos que se cotizaron, en el orden de MODULES. Los demás la persona ya los resolvió por su cuenta."""
    on = {"vuelos": req.services.flights, "alojamiento": req.services.lodging, "actividades": req.services.activities}
    return [m for m in MODULES if on[m]]


class FunnelFacts(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[3] = 3
    # qué se cotizó: de lo que no está acá el texto no puede hablar (la persona ya lo tiene resuelto)
    quoted: list[Module] = list(MODULES)
    destinations: list[str]  # un solo viaje que pasa por todas, en este orden
    travelers: int
    rejections: list[RejectionFact]
    impossible_date_options: int = Field(ge=0)  # combinaciones de fechas y noches sin viaje posible
    date_options: int = Field(ge=0)
    # por qué cada combinación de fechas no tiene viaje, agrupado ("sin vuelos para la ida a Orlando": 3)
    impossible_reasons: list[RejectionFact] = []
    legal_rules: list[LegalFact] = []
    relaxations: list[Relaxation]


# ---------------------------------------------------------------- contrafactuales

# Regla de descarte -> restricción que la produce, cómo aflojarla un paso y cómo mostrar el valor.
@dataclass(frozen=True)
class _Lever:
    module: Module  # el módulo que tiene que estar cotizado para que aflojarla tenga sentido
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
    "flight.too_many_stops": _Lever(module="vuelos", field="max_stops", setting="escalas máximas por tramo",
                                    step=_int_step(+1, 0, 3), show=str),
    "flight.arrives_too_late": _Lever(module="vuelos", field="latest_arrival_hour", setting="hora máxima de llegada",
                                      step=_int_step(+2, 0, 23), show=_hour),
    "flight.departs_too_early": _Lever(module="vuelos", field="earliest_departure_hour", setting="hora mínima de salida",
                                       step=_int_step(-2, 0, 23), show=_hour),
    "lodging.bathrooms": _Lever(module="alojamiento", field="min_bathrooms", setting="baños mínimos",
                                step=_int_step(-1, 0, 10), show=str),
    "lodging.bedrooms": _Lever(module="alojamiento", field="min_bedrooms", setting="dormitorios mínimos",
                               step=_int_step(-1, 0, 10), show=str),
    "lodging.no_kitchen": _Lever(module="alojamiento", field="require_kitchen", setting="exigir cocina",
                                 step=_off, show=_yes_no),
    "lodging.kitchen_unknown": _Lever(module="alojamiento", field="require_kitchen", setting="exigir cocina",
                                      step=_off, show=_yes_no),
    "activity.weather_rain": _Lever(module="actividades", field="max_heavy_rain_prob", setting="tolerancia a la lluvia",
                                    step=_rain_step, show=_pct),
}


def relaxed_requests(req: TripRequest, counts: dict[str, int]) -> list[tuple[_Lever, object, object, TripRequest]]:
    """Las restricciones a aflojar, de la que más descartó a la que menos (una por campo, hasta MAX_RELAXATIONS).
    Orden determinístico: cantidad descendente y, a igualdad, nombre de la regla."""
    out: list[tuple[_Lever, object, object, TripRequest]] = []
    seen: set[str] = set()
    quoted = quoted_modules(req)
    for reason, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])):
        lever = LEVERS.get(reason)
        if lever is None or lever.module not in quoted or lever.field in seen:
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


def _leg_text(index: int, names: list[str]) -> str:
    if index == 0:
        return f"la ida a {names[0]}"
    if index >= len(names):
        return f"la vuelta desde {names[-1]}"
    return f"el tramo {names[index - 1]} → {names[index]}"


def impossible_reason(skeleton_id: object, why: object, names_by_code: dict[str, str]) -> str | None:
    """"ORL-NYC|2027-07-08|8-4" + "sin_vuelo:tramo_0" -> "sin vuelos para la ida a Orlando". None si la forma no se
    reconoce: un motivo desconocido no se inventa ni se traduce a medias."""
    if not isinstance(skeleton_id, str) or not isinstance(why, str) or ":" not in why:
        return None
    order = [names_by_code.get(c, c) for c in skeleton_id.split("|")[0].split("-") if c]
    code, _, target = why.partition(":")
    if code == "sin_vuelo" and target.startswith("tramo_") and target[6:].isdigit() and order:
        return f"sin vuelos para {_leg_text(int(target[6:]), order)}"
    city = names_by_code.get(target, target)
    if code == "sin_alojamiento" and target:
        return f"sin alojamiento que cumpla tus condiciones en {city}"
    if code == "actividades_infactibles" and target:
        return f"los imperdibles no entran en las noches de {city}"
    return None


def legal_facts(req: TripRequest, counts: dict[str, int], legal: LegalRules) -> list[LegalFact]:
    """Normas locales que descartaron alquileres en esta búsqueda: solo si hubo descartes por legalidad y solo para las
    ciudades cuya estadía es más corta que el mínimo. Sin reglas legibles (fallo cerrado), se dice que no se verificó."""
    if not counts.get("lodging.short_term_not_legal"):
        return []
    if not legal.complete:
        return [LegalFact(city=c.name or c.code, rule="no se pudo verificar la norma local y se descartaron por precaución",
                          source="no_verificada") for c in req.cities]
    out = []
    for c in req.cities:
        minimum = legal.short_term_min_nights.get(c.code)
        if minimum is not None and c.min_nights < minimum:
            out.append(LegalFact(city=c.name or c.code, rule=f"alquiler temporario permitido solo desde {minimum} noches",
                                 source="oficial" if legal.sources.get(c.code) == "official" else "secundaria"))
    return out


def build_facts(req: TripRequest, summary: dict, relaxations: list[Relaxation],
                legal_rules: list[LegalFact] | None = None) -> FunnelFacts:
    diagnostics = summary.get("diagnostics") if isinstance(summary, dict) else None
    counts = rejection_counts(diagnostics)
    infeasible = diagnostics.get("infeasible_skeletons") if isinstance(diagnostics, dict) else None
    stats = summary.get("stats") if isinstance(summary, dict) else None
    total = stats.get("skeletons_total") if isinstance(stats, dict) else None
    rejections = [
        RejectionFact(what=REASON_LABEL.get(reason, reason), count=n)
        for reason, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:MAX_REJECTIONS]
    ]
    names = {c.code: c.name or c.code for c in req.cities}
    grouped: dict[str, int] = {}
    for sid, why in (infeasible.items() if isinstance(infeasible, dict) else []):
        text = impossible_reason(sid, why, names)
        if text is not None:
            grouped[text] = grouped.get(text, 0) + 1
    impossible = [RejectionFact(what=w, count=n)
                  for w, n in sorted(grouped.items(), key=lambda kv: (-kv[1], kv[0]))[:MAX_REJECTIONS]]
    return FunnelFacts(
        quoted=quoted_modules(req),
        destinations=[names[c.code] for c in req.cities],
        travelers=req.pax,
        rejections=rejections,
        impossible_date_options=len(infeasible) if isinstance(infeasible, dict) else 0,
        date_options=total if isinstance(total, int) and total >= 0 else 0,
        impossible_reasons=impossible,
        legal_rules=legal_rules or [],
        relaxations=relaxations,
    )


def relaxation_fact(lever: _Lever, current: object, proposed: object, best_total_minor: int | None) -> Relaxation:
    return Relaxation(
        setting=lever.setting, current=lever.show(current), proposed=lever.show(proposed),
        feasible=best_total_minor is not None,
        best_total=fmt(best_total_minor) if best_total_minor is not None else None,
    )
