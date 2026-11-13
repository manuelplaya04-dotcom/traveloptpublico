"""Reglas legales por ciudad (tabla `city_legal_rules`) que el motor aplica como restricción dura.

`short_term_min_nights`: por debajo de esas noches, el alquiler temporario solo es legal con condiciones que el
proveedor no informa (anfitrión registrado, licencia). Esos alquileres se descartan con el motivo
`lodging.short_term_not_legal` en el embudo y quedan los hoteles.

Si las reglas no se pueden leer, se falla cerrado: ningún alquiler temporario pasa. Recomendar uno ilegal es peor que
mostrar solo hoteles.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

SourceKind = Literal["official", "secondary"]


@dataclass(frozen=True)
class LegalRules:
    short_term_min_nights: dict[str, int] = field(default_factory=dict)
    sources: dict[str, SourceKind] = field(default_factory=dict)
    complete: bool = True  # False: no se pudieron leer las reglas (fallo cerrado)

    def rental_allowed(self, city: str, nights: int) -> bool:
        if not self.complete:
            return False
        minimum = self.short_term_min_nights.get(city)
        return minimum is None or nights >= minimum


# Mismas reglas que siembra la migración del catálogo: las usa el repositorio en memoria (tests y modo local sin base).
SEED_RULES = LegalRules(
    short_term_min_nights={"NYC": 30, "BKN": 30, "LAX": 31, "SFO": 30, "LAS": 31},
    sources={"NYC": "official", "BKN": "official", "LAX": "official", "SFO": "secondary", "LAS": "secondary"},
)
FAIL_CLOSED = LegalRules(complete=False)
