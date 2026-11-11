"""Caché de respuestas externas (cache-first) con coalescencia de pedidos concurrentes.

TTL por tipo de dato: los precios caducan rápido; el clima histórico nunca caduca. Una entrada vencida no se sirve como
fresca, pero se conserva hasta la retención (30 días): es el respaldo del modo histórico cuando la cuota de un proveedor
se agota (`entry(..., stale_ok=True)`).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Awaitable, Callable, Protocol

TTL_S = {
    "flights": 30 * 60,
    "lodging": 24 * 3600,  # las tarifas de hotel se mueven por día, no por minuto (y la cuota es de 250/mes)
    "activities": 24 * 3600,
    "weather_forecast": 3 * 3600,
    "weather_history": None,  # inmutable
}


@dataclass(frozen=True)
class Entry:
    value: Any
    fetched_at: datetime  # UTC: cuándo se trajo del proveedor


class Cache(Protocol):
    async def get(self, key: str) -> Any | None: ...

    async def entry(self, key: str, stale_ok: bool = False) -> Entry | None: ...

    async def set(self, key: str, provider: str, value: Any, ttl_s: int | None,
                  fetched_at: datetime | None = None) -> None: ...


def cache_key(provider: str, endpoint: str, params: dict) -> str:
    """params NUNCA debe incluir credenciales."""
    raw = json.dumps([provider, endpoint, params], sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


class MemoryCache:
    def __init__(self):
        self._data: dict[str, tuple[Any, float | None, datetime]] = {}

    async def get(self, key: str) -> Any | None:
        e = await self.entry(key)
        return None if e is None else e.value

    async def entry(self, key: str, stale_ok: bool = False) -> Entry | None:
        hit = self._data.get(key)
        if hit is None:
            return None
        value, expires, fetched_at = hit
        if not stale_ok and expires is not None and expires < time.monotonic():
            return None
        return Entry(value, fetched_at)

    async def set(self, key: str, provider: str, value: Any, ttl_s: int | None,
                  fetched_at: datetime | None = None) -> None:
        self._data[key] = (value, None if ttl_s is None else time.monotonic() + ttl_s, fetched_at or datetime.now(UTC))


_inflight: dict[str, asyncio.Task[Entry]] = {}


async def cached_entry(
    cache: Cache, key: str, provider: str, ttl_s: int | None, fetch: Callable[[], Awaitable[Any]]
) -> tuple[Entry, bool]:
    """Devuelve (entrada con fecha de extracción, fue_cache_hit). Pedidos idénticos simultáneos comparten UNA llamada
    (request collapsing). Si `fetch` falla no se guarda nada y todos reciben el mismo error.

    La llamada corre en una tarea propia, no dentro del primer pedido: si ese pedido se cancela (timeout de 4 s de una
    API no crítica, un `gather` que corta), los demás no quedan esperando para siempre y la respuesta igual llega a la
    caché. Cada uno espera con `shield`: cancelar a uno no cancela la llamada compartida. El tiempo máximo de espera
    es el de `fetch`, acotado por los timeouts y reintentos del cliente HTTP."""
    hit = await cache.entry(key)
    if hit is not None:
        return hit, True
    loop = asyncio.get_running_loop()
    task = _inflight.get(key)
    if task is not None and task.get_loop() is loop:  # sin await entre leer y dar de alta: no hay carrera en asyncio
        return await asyncio.shield(task), True

    async def run() -> Entry:
        value = await fetch()
        entry = Entry(value, datetime.now(UTC))  # una sola marca: la que se guarda es la que ve quien pidió
        await cache.set(key, provider, value, ttl_s, entry.fetched_at)
        return entry

    task = loop.create_task(run())
    _inflight[key] = task

    def done(t: asyncio.Task[Entry]) -> None:
        if _inflight.get(key) is t:
            _inflight.pop(key)
        if not t.cancelled():
            t.exception()  # marca el error como leído aunque ya no quede nadie esperando

    task.add_done_callback(done)
    return await asyncio.shield(task), False


async def cached(
    cache: Cache, key: str, provider: str, ttl_s: int | None, fetch: Callable[[], Awaitable[Any]]
) -> tuple[Any, bool]:
    """Devuelve (valor, fue_cache_hit)."""
    entry, hit = await cached_entry(cache, key, provider, ttl_s, fetch)
    return entry.value, hit
