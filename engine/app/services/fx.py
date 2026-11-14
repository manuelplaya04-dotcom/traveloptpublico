"""Cotización del dólar en Argentina, solo para mostrar precios en pesos.

El motor, CP-SAT y la base siguen en USD (centavos, `int`): esto no entra a ningún cálculo ni total que concilie. La web
convierte en el navegador lo que ya tiene en dólares.

- **Fuente:** dolarapi.com (pública, sin clave). Dos cotizaciones, las dos formas reales de pagar un viaje en dólares
  desde Argentina: tarjeta (oficial + percepciones) y MEP ("bolsa").
- **Caché en la base** (`api_cache`, la misma de clima y precios): 30 min. Vercel no comparte memoria entre instancias,
  así que sin esto cada instancia fría consultaría la API. El motor es el único que escribe en la base.
- **Degradación elegante (norma 4):** si la API falla o responde otra cosa, se sirve la última cotización guardada de
  hasta 24 h, marcada `stale`; si no hay, `None` y la web muestra USD con un aviso. Nunca se inventa una cotización.
- **Sin flotantes:** la cotización viaja como centavos de peso por dólar (`int`), así la web convierte con enteros.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from app.services.cache import Cache, cache_key, cached_entry
from app.services.http import UpstreamError, fetch_json

PROVIDER = "dolarapi"
URL = "https://dolarapi.com/v1/dolares"
TTL_S = 30 * 60
STALE_MAX = timedelta(hours=24)
KEY = cache_key(PROVIDER, URL, {})


class _Row(BaseModel):
    model_config = ConfigDict(extra="ignore")
    casa: str
    venta: Decimal = Field(gt=0, lt=10**7, allow_inf_nan=False)
    fechaActualizacion: datetime


_ROWS: TypeAdapter[list[_Row]] = TypeAdapter(list[_Row])


class Rate(BaseModel):
    cents_per_usd: int = Field(gt=0)  # centavos de peso por dólar (1.475,50 ARS/USD -> 147550)
    updated_at: datetime  # cuándo la publicó la fuente


class ArsRates(BaseModel):
    tarjeta: Rate
    mep: Rate
    source: Literal["dolarapi.com"] = "dolarapi.com"
    fetched_at: datetime  # cuándo la trajo el motor
    stale: bool  # la fuente falló y es la última guardada (de hasta 24 h)


class FxPayloadError(UpstreamError):
    """La fuente respondió, pero sin las dos cotizaciones con el formato esperado."""


def _cents(venta: Decimal) -> int:
    return int((venta * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def pick(payload: object) -> dict:
    """Respuesta de dolarapi -> {tarjeta, mep} en centavos. Sin alguna de las dos, error (no se inventa la otra)."""
    try:
        rows = {r.casa: r for r in _ROWS.validate_python(payload)}
    except ValidationError as exc:
        raise FxPayloadError(PROVIDER, None, "formato inesperado") from exc
    t, m = rows.get("tarjeta"), rows.get("bolsa")  # "bolsa" es el MEP
    if t is None or m is None:
        raise FxPayloadError(PROVIDER, None, "faltan tarjeta o MEP")
    return {k: {"cents_per_usd": _cents(r.venta), "updated_at": r.fechaActualizacion.isoformat()}
            for k, r in (("tarjeta", t), ("mep", m))}


async def ars_rates(client: httpx.AsyncClient, cache: Cache, now: datetime | None = None) -> ArsRates | None:
    async def fetch() -> dict:
        return pick(await fetch_json(client, "GET", URL, provider=PROVIDER, max_attempts=2))

    try:
        entry, _ = await cached_entry(cache, KEY, PROVIDER, TTL_S, fetch)
        stale = False
    except (UpstreamError, httpx.HTTPError):  # incluye el circuito abierto y el formato inesperado
        old = await cache.entry(KEY, stale_ok=True)
        if old is None or (now or datetime.now(UTC)) - old.fetched_at > STALE_MAX:
            return None
        entry, stale = old, True
    return ArsRates.model_validate({**entry.value, "fetched_at": entry.fetched_at, "stale": stale})
