"""Asesor de momento óptimo: ¿este precio real es bueno comparado con lo que costó la misma ruta y fecha en los
últimos 30 días?

La estadística la calcula Postgres (`public.flight_price_stats`: percentiles exactos, sin duplicados ni datos de
prueba). Acá solo se clasifica, con reglas robustas ante precios anómalos (percentiles, nunca promedios):

- precio ≤ percentil 20 → "opportunity" (🚀 entre el 20% más barato visto)
- precio ≥ percentil 80 → "wait" (⚠️ elevado frente a lo visto)
- en el medio → "standard"

**Cold start:** con menos de `MIN_SNAPSHOTS` momentos de cotización distintos no hay historial suficiente y no se
da consejo (None): la web oculta la etiqueta en vez de arriesgar uno malo.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

MIN_SNAPSHOTS = 3

Advice = Literal["opportunity", "standard", "wait"]


@dataclass(frozen=True)
class PriceStats:
    snapshots: int  # momentos de cotización distintos (no ofertas)
    observations: int
    p20: float | None
    median: float | None
    p80: float | None


def classify(price_minor: int, stats: PriceStats | None) -> Advice | None:
    if stats is None or stats.snapshots < MIN_SNAPSHOTS or stats.p20 is None or stats.p80 is None:
        return None  # cold start: mejor no aconsejar que aconsejar mal
    if price_minor <= stats.p20:
        return "opportunity"
    if price_minor >= stats.p80:
        return "wait"
    return "standard"


def percentiles(prices: list[int]) -> tuple[float, float, float]:
    """p20, mediana y p80 con interpolación lineal (igual que percentile_cont de Postgres). Para el repositorio en
    memoria (tests y local sin base); acotado al historial de una sola ruta y fecha."""
    s = sorted(prices)

    def p(q: float) -> float:
        pos = q * (len(s) - 1)
        lo, frac = int(pos), pos - int(pos)
        return s[lo] + (s[min(lo + 1, len(s) - 1)] - s[lo]) * frac

    return p(0.2), p(0.5), p(0.8)
