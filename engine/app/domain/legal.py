"""Reglas legales por ciudad (tabla `city_legal_rules`) que el motor aplica como restricción dura.

Dos formas de norma, según cómo la escribe cada ciudad:
- `short_term_min_nights`: por debajo de esas noches, el alquiler temporario solo es legal con condiciones que el
  proveedor no informa (anfitrión registrado, licencia). Desde ese mínimo ya no es alquiler temporario.
- `registration_required`: todo alquiler de vivienda entera a turistas exige un número de registro de la ciudad, sin
  importar las noches (París). El proveedor no lo informa, así que no se puede verificar.
En ambos casos esos alquileres se descartan con el motivo `lodging.short_term_not_legal` en el embudo y quedan los
hoteles.

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
    registration_required: frozenset[str] = frozenset()
    sources: dict[str, SourceKind] = field(default_factory=dict)
    complete: bool = True  # False: no se pudieron leer las reglas (fallo cerrado)

    def rental_allowed(self, city: str, nights: int) -> bool:
        if not self.complete or city in self.registration_required:
            return False
        minimum = self.short_term_min_nights.get(city)
        return minimum is None or nights >= minimum


# Mismas reglas que siembran las migraciones del catálogo: las usa el repositorio en memoria (tests y modo local sin
# base). test_legal.py exige que coincidan.
SEED_RULES = LegalRules(
    short_term_min_nights={"NYC": 30, "BKN": 30, "LAX": 31, "SFO": 30, "LAS": 31},
    registration_required=frozenset({"PAR", "AMS", "BRG"}),
    sources={"NYC": "official", "BKN": "official", "LAX": "official", "SFO": "secondary", "LAS": "official",
             "PAR": "official", "AMS": "official", "BRG": "official"},
)
FAIL_CLOSED = LegalRules(complete=False)
