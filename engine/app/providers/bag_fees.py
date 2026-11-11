"""Costo de valijas despachadas cuando el proveedor de vuelos no lo informa (Google Flights no lo publica).

Tabla estática de tarifas publicadas (`app/data/bag_fees.json`, con fuente y fecha) solo para vuelos dentro de
EE.UU. y para la 1.ª y 2.ª valija: ahí las tarifas son fijas por aerolínea. En vuelos internacionales la franquicia
depende de la tarifa comprada y para 3 o más valijas no hay tarifa publicada en la fuente: el costo queda
**desconocido** (`bag_fee_known=False`) y la web avisa que no está sumado. Nunca se inventa un monto.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

# Aeropuertos de EE.UU. del catálogo (un tramo es doméstico si sale y llega a uno de estos).
US_AIRPORTS = frozenset({"JFK", "LGA", "EWR", "MCO", "MIA", "PHL", "BOS", "IAD", "DCA", "FLL", "ORD", "ATL", "CLT",
                         "DFW", "LAX", "SFO", "SEA", "DEN"})


@lru_cache(maxsize=1)
def _table() -> dict[str, list[int]]:
    data = json.loads((Path(__file__).parent.parent / "data" / "bag_fees.json").read_text(encoding="utf-8"))
    return data["domestic_usd"]


def bag_fee_per_bag_minor(carrier: str, origin: str, destination: str, bags: int) -> int | None:
    """Costo promedio por valija (centavos, por pasajero) para `bags` valijas, o None si no hay tarifa publicada.
    Con 2 valijas se promedia 1.ª y 2.ª (45 y 55 -> 50): el modelo canónico cobra `bags × bag_fee_minor`."""
    if bags <= 0:
        return 0
    fees = _table().get(carrier)
    if fees is None or bags > len(fees) or origin not in US_AIRPORTS or destination not in US_AIRPORTS:
        return None
    total = sum(fees[:bags]) * 100
    return total // bags if total % bags == 0 else None  # sin centavos fraccionarios: si no divide exacto, desconocido
