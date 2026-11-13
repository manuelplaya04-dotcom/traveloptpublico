"""Contrato común de proveedores (patrón Adapter).

Cada fuente externa (fixture, Duffel, OpenWeather, etc.) implementa los métodos de su categoría y
devuelve modelos canónicos. El motor nunca ve JSON crudo de un proveedor. El registry asigna un
proveedor por categoría, así que una clase puede cubrir solo algunas (p. ej. el clima real).
"""
from __future__ import annotations

import asyncio
from datetime import date
from typing import Literal, Protocol

from app.domain.models import (
    ActivityOffer,
    FlightOffer,
    LodgingOffer,
    OfferSet,
    TransportQuote,
    WeatherDay,
)
from app.optimizer.skeletons import FlightQuery, QueryPlan, Stay

# categoría -> atributo del QueryPlan que se le pasa al método homónimo del proveedor
_PLAN_FIELD = {"flights": "flights", "lodging": "stays", "activities": "city_days",
               "weather": "city_days", "transport": "cities"}
Kind = Literal["flights", "lodging", "activities", "weather", "transport"]
KINDS: tuple[Kind, ...] = ("flights", "lodging", "activities", "weather", "transport")
assert set(KINDS) == set(_PLAN_FIELD)


class Provider(Protocol):
    name: str

    async def flights(self, queries: list[FlightQuery]) -> list[FlightOffer]: ...

    async def lodging(self, stays: list[Stay]) -> list[LodgingOffer]: ...

    async def activities(self, city_days: list[tuple[str, date]]) -> list[ActivityOffer]: ...

    async def weather(self, city_days: list[tuple[str, date]]) -> list[WeatherDay]: ...

    async def transport(self, cities: list[str]) -> list[TransportQuote]: ...


def planned(plan: QueryPlan, kind: str) -> bool:
    """¿El plan pide algo de esta categoría? Un módulo apagado deja su parte del plan vacía."""
    return bool(getattr(plan, _PLAN_FIELD[kind]))


async def fetch(provider: object, kind: str, plan: QueryPlan) -> list:
    """Pide a `provider` las ofertas de una categoría usando la parte del plan que le corresponde. Sin consultas
    (módulo no pedido) no se llama al proveedor: cero búsquedas pagas y cero dependencia de que esté disponible."""
    if not planned(plan, kind):
        return []
    return await getattr(provider, kind)(list(getattr(plan, _PLAN_FIELD[kind])))


async def collect_offers(plan: QueryPlan, provider: Provider) -> OfferSet:
    """Fan-out concurrente en proceso (útil para tests y modo local sin n8n)."""
    results = await asyncio.gather(*(fetch(provider, k, plan) for k in KINDS))
    return OfferSet(**dict(zip(KINDS, results)))
