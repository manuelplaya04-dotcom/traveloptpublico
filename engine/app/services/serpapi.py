"""Acceso compartido a SerpApi: caché primero, medidor de cuota y modo histórico.

La cuota del plan gratuito (250 búsquedas/mes) es UNA sola para vuelos y hoteles. Cada búsqueda pasa por acá:

1. Caché fresca (por parámetros, sin la clave): no gasta cuota.
2. Si falta y la cuota está agotada (medidor o rechazo de SerpApi): **modo histórico**, la última respuesta guardada
   aunque esté vencida, marcada `stale`. Nunca se inventa un precio.
3. Si tampoco hay nada guardado: `QuotaExhausted`, error controlado que la web traduce en "probá otras fechas o más
   tarde".

El medidor consulta la API de cuenta de SerpApi (`account.json`, no consume búsquedas) cada pocos minutos y se apaga
solo en cuanto SerpApi rechaza por cuota, hasta la próxima lectura.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx

from app.services.alerts import report
from app.services.cache import Cache, cache_key, cached_entry
from app.services.http import RequestStats, UpstreamError, fetch_json

logger = logging.getLogger(__name__)

URL = "https://serpapi.com/search.json"
ACCOUNT_URL = "https://serpapi.com/account.json"
# SerpApi responde 200 con este error cuando la búsqueda no tiene resultados: es "sin ofertas", no una falla.
NO_RESULTS = "hasn't returned any results"
_QUOTA_ERRORS = ("run out of searches", "plan searches left", "searches per month")


class QuotaExhausted(UpstreamError):
    """Cuota de SerpApi agotada y sin respuesta guardada para esta búsqueda."""

    def __init__(self, provider: str):
        super().__init__(provider, 429, "cuota agotada y sin datos históricos para esta búsqueda")


def is_quota_error(message: str) -> bool:
    m = message.lower()
    return any(s in m for s in _QUOTA_ERRORS)


class QuotaMeter:
    """Búsquedas restantes del mes. Una por proceso (Render corre una instancia); `reserve` deja un margen sin tocar."""

    def __init__(self, refresh_s: float = 600, clock=time.monotonic):
        self.refresh_s, self.clock = refresh_s, clock
        self.left: int | None = None  # None = desconocido (no se pudo leer): no bloquea
        self.read_at: float | None = None
        self._lock = asyncio.Lock()

    def exhausted(self, reserve: int = 0) -> bool:
        return self.left is not None and self.left <= reserve

    def mark_exhausted(self) -> None:
        self.left, self.read_at = 0, self.clock()

    def spent(self) -> None:
        if self.left is not None:
            self.left = max(0, self.left - 1)

    async def refresh(self, client: httpx.AsyncClient, api_key: str) -> None:
        async with self._lock:
            if self.read_at is not None and self.clock() - self.read_at < self.refresh_s:
                return
            self.read_at = self.clock()
            try:
                data = await fetch_json(client, "GET", ACCOUNT_URL, provider="serpapi_account",
                                        params={"api_key": api_key}, max_attempts=1)
            except (UpstreamError, httpx.HTTPError):
                return  # sin lectura se sigue con el último valor; el rechazo de SerpApi igual apaga el medidor
            left = data.get("total_searches_left")
            self.left = left if isinstance(left, int) and not isinstance(left, bool) else None


METER = QuotaMeter()


@dataclass(frozen=True)
class Quote:
    data: dict[str, Any]
    fetched_at: datetime
    stale: bool  # True = modo histórico (cuota agotada): dato guardado, vencido


class SerpApi:
    """Una búsqueda de un motor de SerpApi (`google_flights`, `google_hotels`), con caché y cuota compartidas."""

    def __init__(self, provider: str, api_key: str, client: httpx.AsyncClient, cache: Cache,
                 stats: RequestStats | None = None, meter: QuotaMeter | None = None, reserve: int = 0):
        self.provider, self.api_key, self.client, self.cache, self.stats = provider, api_key, client, cache, stats
        self.meter, self.reserve = meter or METER, reserve

    async def _fetch(self, params: dict) -> dict:
        await self.meter.refresh(self.client, self.api_key)
        if self.meter.exhausted(self.reserve):
            raise QuotaExhausted(self.provider)
        data = await fetch_json(self.client, "GET", URL, provider=self.provider, stats=self.stats,
                                params={**params, "api_key": self.api_key})
        error = str(data.get("error") or "")
        if is_quota_error(error):
            self.meter.mark_exhausted()
            report("serpapi_quota_exhausted", "error", provider=self.provider)
            raise QuotaExhausted(self.provider)
        if error and NO_RESULTS not in error:
            raise UpstreamError(self.provider, 200, error[:200])  # no se cachea: el próximo pedido reintenta
        self.meter.spent()
        return data

    def _key(self, params: dict) -> str:
        return cache_key(self.provider, URL, params)

    async def is_fresh(self, params: dict) -> bool:
        """¿Esta búsqueda sale gratis (de la caché)? Para presupuestar la corrida antes de gastar cuota."""
        return await self.cache.entry(self._key(params)) is not None

    async def search(self, params: dict, ttl_s: int | None) -> Quote:
        """`params` SIN la clave: son también la clave de caché. Si la búsqueda en vivo no se puede hacer (cuota
        agotada, error o timeout tras los reintentos), se usa la última respuesta real guardada, marcada `stale`."""
        key = self._key(params)
        try:
            entry, hit = await cached_entry(self.cache, key, self.provider, ttl_s, lambda: self._fetch(params))
        except (UpstreamError, httpx.HTTPError):  # incluye QuotaExhausted y CircuitOpen
            old = await self.cache.entry(key, stale_ok=True)
            if old is None:
                raise
            if self.stats is not None:
                self.stats.stale_hits += 1
            report("serpapi_historical", provider=self.provider)
            return Quote(old.value, old.fetched_at, stale=True)
        if hit and self.stats is not None:
            self.stats.cache_hits += 1
        return Quote(entry.value, entry.fetched_at, stale=False)


async def gather_partial(provider: str, stats: RequestStats | None, searches: list) -> list:
    """Corre las búsquedas en paralelo sin fallas en cascada: si algunas fallan (y no hay dato guardado), se devuelve
    lo que respondió y se cuenta en `stats.partial_failures`; solo si fallan TODAS se propaga el error."""
    results = await asyncio.gather(*searches, return_exceptions=True)
    failures = [r for r in results if isinstance(r, BaseException)]
    for r in failures:
        if not isinstance(r, (UpstreamError, httpx.HTTPError)):
            raise r  # un bug no es una falla del proveedor
    if failures and len(failures) == len(results):
        raise failures[0]
    if failures:
        report("serpapi_partial_failure", provider=provider, failed=len(failures), total=len(results))
        if stats is not None:
            stats.partial_failures += len(failures)
    return [r for r in results if not isinstance(r, BaseException)]
