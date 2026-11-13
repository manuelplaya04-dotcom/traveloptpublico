from __future__ import annotations

from app.optimizer.price_advice import PriceStats

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Protocol

from pydantic import BaseModel

from app.domain import models
from app.domain.legal import LegalRules
from app.domain.models import OfferSet, TripRequest

NON_TERMINAL = {"queued", "extracting", "optimizing"}
OFFER_MODELS = {
    "flights": "FlightOffer",
    "lodging": "LodgingOffer",
    "activities": "ActivityOffer",
    "weather": "WeatherDay",
    "transport": "TransportQuote",
}


@dataclass(frozen=True)
class RunLimits:
    per_user_active: int
    per_user_hour: int
    total_active: int
    per_client_hour: int = 20  # por conexión (clave seudónima de la IP): frena a quien abre sesiones nuevas en serie


class RateLimited(Exception):
    def __init__(self, scope: str, **counts: int):
        super().__init__(scope)
        self.scope, self.counts = scope, counts


def check_limits(lim: RunLimits, total_active: int, active: int, last_hour: int, client_hour: int = 0) -> None:
    if total_active >= lim.total_active:
        raise RateLimited("global", total_active=total_active)
    if active >= lim.per_user_active or last_hour >= lim.per_user_hour:
        raise RateLimited("user", active=active, last_hour=last_hour)
    if client_hour >= lim.per_client_hour:
        raise RateLimited("client", last_hour=client_hour)


@dataclass
class RunRecord:
    id: str
    user_id: str | None
    status: str
    mode: str
    request: TripRequest
    summary: dict
    error: dict | None
    timings: dict


def offer_key(kind: str, o: BaseModel) -> tuple[str, str]:
    """(offer_id, provider) estable para el upsert idempotente."""
    if isinstance(o, models.WeatherDay):
        return f"{o.city}@{o.date.isoformat()}", o.source
    if isinstance(o, (models.FlightOffer, models.LodgingOffer, models.ActivityOffer, models.TransportQuote)):
        return o.id, o.provider
    raise TypeError(f"oferta de tipo inesperado para '{kind}': {type(o).__name__}")


def build_offer_set(rows: Iterable[tuple[str, dict]]) -> OfferSet:
    """Reconstruye un OfferSet desde filas (kind, payload) respetando el orden recibido."""
    data: dict[str, list] = {k: [] for k in OFFER_MODELS}
    for kind, payload in rows:
        data[kind].append(getattr(models, OFFER_MODELS[kind]).model_validate(payload))
    return OfferSet(**data)


class Repository(Protocol):
    async def create_run(self, req: TripRequest, mode: str, user_id: str | None,
                         limits: RunLimits | None = None, client_key: str | None = None) -> str:
        """Crea la corrida. Con `limits`, cuenta y crea de forma atómica o levanta RateLimited. `client_key`: clave
        seudónima de la conexión (HMAC de la IP), para el límite por conexión."""
        ...

    async def get_run(self, run_id: str) -> RunRecord | None: ...

    async def transition(
        self, run_id: str, allowed_from: set[str], to: str, *, summary: dict | None = None, error: dict | None = None
    ) -> bool: ...

    async def upsert_offers(self, run_id: str, kind: str, offers: list[BaseModel]) -> int: ...

    async def mark_degraded(self, run_id: str, kind: str, reason: str) -> None:
        """Agrega `summary.degraded[kind] = reason` de forma atómica (las extracciones corren en paralelo)."""
        ...

    async def load_offers(self, run_id: str) -> OfferSet: ...

    async def save_itineraries(self, run_id: str, user_id: str | None, rows: list[dict]) -> None: ...

    async def get_itineraries(self, run_id: str) -> list[dict]: ...

    async def log_usage(self, run_id: str, events: list[dict]) -> None: ...

    async def reap_stale(self, older_than_s: int) -> int: ...

    async def log_client_error(self, user_id: str, message: str, digest: str | None, path: str | None) -> None:
        """Error de render del navegador (Error Boundary). Retención: lo borra `purge_older_than`."""
        ...

    async def flight_price_stats(self, origin: str, destination: str, day: str) -> PriceStats:
        """Historial de 30 días de precios reales de la ruta y fecha (ver public.flight_price_stats)."""
        ...

    async def legal_rules(self) -> LegalRules:
        """Reglas legales por ciudad (public.city_legal_rules). Si no se pueden leer: FAIL_CLOSED."""
        ...

    async def create_share(self, run_id: str, user_id: str) -> str:
        """Token de solo lectura para compartir la corrida (el mismo si ya existía para ese usuario)."""
        ...

    async def get_share(self, token: str) -> str | None:
        """run_id del link si existe y no venció; None si no."""
        ...

    async def purge_older_than(self, days: int) -> int:
        """Retención: borra las búsquedas (y en cascada corridas, ofertas e itinerarios) con más de `days` días, más el
        registro de uso de APIs y el caché vencido. Devuelve cuántas búsquedas borró."""
        ...


    async def close(self) -> None: ...
