"""Cliente HTTP resiliente: lista blanca de salida, token bucket y circuit breaker por proveedor, reintentos con
backoff exponencial, jitter y respeto de Retry-After. Nunca loguea query params (pueden contener API keys)."""
from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass, field
from urllib.parse import urlsplit

import httpx

RETRYABLE = {429, 500, 502, 503, 504}


class UpstreamError(RuntimeError):
    def __init__(self, provider: str, status: int | None, detail: str):
        super().__init__(f"{provider} status={status}: {detail}")
        self.provider, self.status = provider, status


class CircuitOpen(UpstreamError):
    """El proveedor viene fallando: se corta sin llamar hasta que pase el enfriamiento."""

    def __init__(self, provider: str):
        super().__init__(provider, None, "circuito abierto")


class CircuitBreaker:
    """Cerrado -> abierto tras `threshold` fallas seguidas -> semiabierto tras `cooldown_s` (deja pasar una prueba).
    Cuenta fallas del proveedor (red, timeout, 429, 5xx), no errores de configuración (4xx)."""

    def __init__(self, threshold: int = 5, cooldown_s: float = 30.0, clock=time.monotonic):
        self.threshold, self.cooldown, self.clock = threshold, cooldown_s, clock
        self.failures, self.opened_at = 0, None

    def check(self, provider: str) -> None:
        if self.opened_at is None:
            return
        if self.clock() - self.opened_at < self.cooldown:
            raise CircuitOpen(provider)
        self.opened_at = None  # semiabierto: la próxima falla lo vuelve a abrir
        self.failures = self.threshold - 1

    def success(self) -> None:
        self.failures, self.opened_at = 0, None

    def failure(self) -> None:
        self.failures += 1
        if self.failures >= self.threshold:
            self.opened_at = self.clock()


BREAKERS: dict[str, CircuitBreaker] = {}


def breaker_for(provider: str) -> CircuitBreaker:
    return BREAKERS.setdefault(provider, CircuitBreaker())


class EgressBlocked(ValueError):
    """Anti-SSRF: el motor solo habla con hosts de la lista blanca, por https y en el puerto estándar."""


# Lista blanca de salida. Sumar un proveedor = sumar su host acá (y su limitador abajo), en el mismo cambio.
EGRESS_ALLOWLIST: frozenset[str] = frozenset({
    "archive-api.open-meteo.com",
    "api.open-meteo.com",
    "api.openweathermap.org",
    "serpapi.com",
    "app.ticketmaster.com",
    "router.project-osrm.org",
    "query.wikidata.org",
    "generativelanguage.googleapis.com",  # Gemini: explicador del embudo
    "dolarapi.com",  # cotización del dólar en Argentina (solo para mostrar pesos; ver app/services/fx.py)
    # webhooks de alertas (la URL concreta es un secreto del entorno; ver app/services/alerts.py)
    "discord.com", "discordapp.com", "hooks.slack.com", "api.telegram.org",
})


def check_egress(url: str) -> None:
    u = urlsplit(url)
    if u.scheme != "https" or u.hostname not in EGRESS_ALLOWLIST or u.username or u.password or u.port not in (None, 443):
        raise EgressBlocked(f"destino no permitido: {u.scheme}://{u.hostname}")


class TokenBucket:
    """rate_per_s tokens/segundo con ráfaga máxima `burst`. Un token = una llamada."""

    def __init__(self, rate_per_s: float, burst: int = 1):
        self.rate, self.capacity = rate_per_s, burst
        self.tokens = float(burst)
        self.updated = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            while True:
                now = time.monotonic()
                self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
                self.updated = now
                if self.tokens >= 1:
                    self.tokens -= 1
                    return
                await asyncio.sleep((1 - self.tokens) / self.rate)


# Límites conservadores por proveedor (ajustar al plan contratado).
LIMITERS: dict[str, TokenBucket] = {
    "open_meteo_climatology": TokenBucket(rate_per_s=5, burst=5),
    "openweather_onecall": TokenBucket(rate_per_s=1, burst=2),
    "open_meteo_forecast": TokenBucket(rate_per_s=5, burst=5),
}
# SerpApi, plan gratuito: 50 búsquedas por hora para TODA la cuenta, así que vuelos, hoteles y eventos comparten el
# mismo balde. La ráfaga cubre una corrida entera (topes de búsquedas por corrida: vuelos + alojamiento).
_SERPAPI_BUCKET = TokenBucket(rate_per_s=50 / 3600, burst=20)
for _name in ("serpapi_google_flights", "serpapi_google_hotels", "serpapi_google_events"):
    LIMITERS[_name] = _SERPAPI_BUCKET
LIMITERS["wikidata_sparql"] = TokenBucket(rate_per_s=1, burst=2)  # servicio público: pocas consultas y User-Agent
LIMITERS["osrm_public"] = TokenBucket(rate_per_s=1, burst=1)  # política del servidor público: 1 pedido por segundo
LIMITERS["ticketmaster_discovery"] = TokenBucket(rate_per_s=4, burst=4)  # la API admite 5 por segundo
LIMITERS["serpapi_account"] = TokenBucket(rate_per_s=1, burst=2)  # lectura de cuota: no consume búsquedas
LIMITERS["dolarapi"] = TokenBucket(rate_per_s=1, burst=2)  # API pública sin clave; con la caché de 30 min alcanza


def limiter_for(provider: str) -> TokenBucket:
    return LIMITERS.setdefault(provider, TokenBucket(rate_per_s=2, burst=2))


@dataclass
class RequestStats:
    api_calls: int = 0
    cache_hits: int = 0
    stale_hits: int = 0  # respuestas del modo histórico (cuota agotada o falla): datos guardados, vencidos
    partial_failures: int = 0  # búsquedas que fallaron sin dato guardado (la corrida sigue con el resto)
    events: list[dict] = field(default_factory=list)  # -> tabla api_usage


async def fetch_json(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    provider: str,
    stats: RequestStats | None = None,
    params: dict | None = None,
    json: dict | None = None,
    headers: dict | None = None,
    max_attempts: int = 4,
    base_delay_s: float = 0.5,
    max_delay_s: float = 8.0,
):
    check_egress(url)  # antes de gastar un token o abrir una conexión
    breaker = breaker_for(provider)
    breaker.check(provider)
    limiter = limiter_for(provider)
    for attempt in range(1, max_attempts + 1):
        await limiter.acquire()
        t0 = time.monotonic()
        status, resp = None, None
        try:
            resp = await client.request(method, url, params=params, json=json, headers=headers)
            status = resp.status_code
        except (httpx.TimeoutException, httpx.TransportError):
            pass
        if stats is not None:
            stats.api_calls += 1
            stats.events.append(
                {"provider": provider, "endpoint": url, "status_code": status,
                 "latency_ms": int((time.monotonic() - t0) * 1000)}
            )
        if resp is not None and resp.status_code < 400:
            breaker.success()
            return resp.json()
        if resp is not None and resp.status_code not in RETRYABLE:
            raise UpstreamError(provider, resp.status_code, resp.text[:200])
        if attempt == max_attempts:
            breaker.failure()
            raise UpstreamError(provider, status, f"agotados {max_attempts} intentos")
        delay = min(max_delay_s, base_delay_s * 2 ** (attempt - 1)) * random.uniform(0.5, 1.0)
        retry_after = resp.headers.get("Retry-After") if resp is not None else None
        if status == 429 and retry_after and retry_after.isdigit():
            delay = max(delay, float(retry_after))
        await asyncio.sleep(delay)
