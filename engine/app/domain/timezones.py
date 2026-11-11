"""Zona horaria de cada aeropuerto (tabla estática, sin red) y duración real de un vuelo.

Los horarios del modelo canónico son LOCALES del aeropuerto: es lo que ve la persona y lo que usan las reglas de hora
mínima y máxima. Dos horas locales de husos distintos no se pueden restar, así que la duración se calcula en UTC.

Incertidumbre explícita: un aeropuerto fuera de la tabla da `None` ("no se sabe"), nunca UTC ni la zona de otro lado.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import NamedTuple
from zoneinfo import ZoneInfo

_TABLE = Path(__file__).parent.parent / "data" / "airport_tz.json"  # origen y licencia: airport_tz.NOTICE.txt


@lru_cache(maxsize=1)
def _table() -> dict[str, str]:
    return json.loads(_TABLE.read_text("utf-8"))


@lru_cache(maxsize=512)
def airport_tz(iata: str) -> ZoneInfo | None:
    name = _table().get(iata)
    return ZoneInfo(name) if name else None


def to_utc(local: datetime, iata: str) -> datetime | None:
    """Hora local (naive) de un aeropuerto -> instante UTC. En el cambio de hora, la hora repetida se toma como la
    primera (`fold=0`) y la inexistente se corre según el offset previo, como hace zoneinfo: margen de 1 h a lo sumo."""
    tz = airport_tz(iata)
    return None if tz is None else local.replace(tzinfo=tz).astimezone(UTC)


class FlightTimes(NamedTuple):
    depart_utc: datetime | None
    arrive_utc: datetime | None
    duration_min: int | None  # None = falta la zona de algún aeropuerto


def flight_times(origin: str, depart: datetime, destination: str, arrive: datetime) -> FlightTimes:
    dep, arr = to_utc(depart, origin), to_utc(arrive, destination)
    if dep is None or arr is None:
        return FlightTimes(dep, arr, None)
    return FlightTimes(dep, arr, int((arr - dep).total_seconds() // 60))
