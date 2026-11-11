"""Selección de proveedores según el modo de la corrida.

fixture : el caso hardcodeado si se pide ese recorrido; si no, datos simulados según el pedido (sin red).
hybrid  : con clave de SerpApi, TODO real (vuelos, alojamiento, actividades con precio publicado, clima; traslados sin
          cotizar). Sin clave, datos de ejemplo con su sello (y clima real).
live    : como hybrid con clave; sin clave, solo las categorías reales disponibles (el resto devuelve 501).
"""
from __future__ import annotations

import httpx

from app.domain.models import TripRequest
from app.providers.base import KINDS, fetch
from app.providers.curated import NoTransportQuotes, RealActivities
from app.providers.fixture import get_fixture
from app.providers.flights import SerpApiFlights
from app.providers.hotels import SerpApiHotels
from app.providers.synthetic import SyntheticProvider, fixture_covers
from app.providers.weather import CompositeWeather, OpenMeteoClimatology, OpenWeatherForecast
from app.services.cache import Cache
from app.services.http import RequestStats
from app.settings import Settings

DEMO_CASE_KEY = "orlando_nyc_5pax"  # caso de prueba (golden) que se reconoce por ruta, fechas y noches

__all__ = ["KINDS", "ProviderNotConfigured", "build_providers", "extract", "serpapi_cost"]


class ProviderNotConfigured(LookupError):
    pass


def build_providers(
    mode: str, req: TripRequest, s: Settings, client: httpx.AsyncClient, cache: Cache, stats: RequestStats,
    rentals: bool = True,
) -> dict[str, object]:
    demo = _demo_provider(req) if mode in ("fixture", "hybrid") else None
    if mode == "fixture":
        return {k: demo for k in KINDS}

    coords = {c.code: (c.lat, c.lon) for c in req.cities}
    forecast = (
        OpenWeatherForecast(s.openweather_api_key, coords, client, cache, stats)
        if s.openweather_api_key
        else None
    )
    weather = CompositeWeather(OpenMeteoClimatology(coords, client, cache, stats), forecast)
    flights = lodging = None
    if s.serpapi_api_key:  # una sola cuenta y cuota para vuelos y hoteles
        flights = SerpApiFlights(s.serpapi_api_key, client, cache, stats, s.max_flight_queries_per_run,
                                 s.serpapi_quota_reserve, req.constraints.checked_bags_per_pax)
        names = {c.code: c.name or c.code for c in req.cities}
        lodging = SerpApiHotels(s.serpapi_api_key, client, cache, stats, names, req.pax,
                                s.max_lodging_queries_per_run, s.serpapi_quota_reserve, rentals)
    if mode == "hybrid" and not s.serpapi_api_key:
        # sin precios reales de vuelos y hoteles, el resto también es de ejemplo (todo con su sello, coherente)
        return {"flights": demo, "lodging": demo, "activities": demo, "transport": demo, "weather": weather}
    # hybrid con clave y live: todo real. Actividades con precio publicado o "entrada en taquilla"; traslados sin
    # cotización (solo logística real en la web). Ningún dato simulado.
    activities = RealActivities(coords, client, cache)
    return {"flights": flights, "lodging": lodging, "activities": activities, "transport": NoTransportQuotes(),
            "weather": weather}


def _demo_provider(req: TripRequest) -> object:
    """Datos de demostración: el fixture si el pedido es su caso (golden intacto); si no, datos simulados que
    responden a las ciudades, fechas, noches y viajeros pedidos."""
    # Sin case_key se usa el caso de demo por defecto: la web no necesita conocer datos de prueba.
    fixture = get_fixture(req.case_key or DEMO_CASE_KEY)
    if fixture and fixture_covers(req, fixture.trip_request()):
        return fixture
    return SyntheticProvider(req, fixture)


async def serpapi_cost(providers: dict[str, object], plan) -> int:
    """Búsquedas de SerpApi que este plan gastaría (0 si no hay proveedores de SerpApi o todo está en caché)."""
    cost = 0
    if isinstance(f := providers.get("flights"), SerpApiFlights):
        cost += await f.pending(list(plan.flights))
    if isinstance(h := providers.get("lodging"), SerpApiHotels):
        cost += await h.pending(list(plan.stays))
    return cost


async def extract(providers: dict[str, object], kind: str, plan) -> list:
    p = providers.get(kind)
    if p is None:
        raise ProviderNotConfigured(f"sin proveedor para '{kind}'")
    return await fetch(p, kind, plan)
