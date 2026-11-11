"""Vuelos reales: SerpApi (motor `google_flights`), plan gratuito sin tarjeta (250 búsquedas/mes, 50/hora).

Adapter puro: traduce la respuesta cruda al modelo canónico (`FlightOffer`). El optimizador no sabe de qué proveedor
vino el dato. Cada consulta del plan es UNA búsqueda de SerpApi (solo ida, una fecha, aeropuertos separados por coma)
y pasa por la caché antes de tocar la red: con una cuota tan chica, la caché es lo que hace viable el plan gratuito.

Decisiones del contrato (ver docs/adr/0001-proveedores.md):
- Se consulta con `adults=1`: el precio es por pasajero sin ambigüedad y la clave de caché no depende del grupo, así
  que dos personas que buscan la misma ruta y fecha comparten la misma consulta.
- Google Flights no informa asientos libres: se usa el tope convencional de los GDS (9) y se confirma al reservar.
- Google Flights no informa la franquicia de valijas despachadas. En vuelos dentro de EE.UU. se usa la tarifa
  publicada de la aerolínea (`bag_fees.py`); si no hay tarifa publicada (internacional, 3+ valijas), el costo queda
  marcado como desconocido (`bag_fee_known=False`) y la web avisa que no está sumado. Nunca un monto inventado.
"""
from __future__ import annotations

import asyncio
import hashlib
import re
from datetime import date, datetime

import httpx

from app.domain.models import FlightOffer
from app.domain.timezones import flight_times
from app.providers.bag_fees import bag_fee_per_bag_minor
from app.optimizer.skeletons import FlightQuery
from app.services.alerts import report
from app.services.cache import TTL_S, Cache
from app.services.http import RequestStats, UpstreamError
from app.services.serpapi import NO_RESULTS, URL, SerpApi, gather_partial

SEATS_UNKNOWN = 9  # convención de los GDS ("9 o más"); Google Flights no publica disponibilidad
_FLIGHT_NO = re.compile(r"^([A-Z0-9]{2})\s?\d{1,4}[A-Z]?$")


class FlightQuotaExceeded(UpstreamError):
    """La corrida pediría más búsquedas que el tope configurado: se corta antes de gastar cuota."""

    def __init__(self, provider: str, needed: int, cap: int):
        super().__init__(provider, None, f"la corrida necesita {needed} búsquedas de vuelos y el tope es {cap}")


def _minor(price: object) -> int | None:
    """SerpApi da el precio en unidades enteras de la moneda pedida (USD). Sin precio, la opción se descarta."""
    if isinstance(price, bool) or not isinstance(price, int) or price < 0:
        return None
    return price * 100


def _local(ts: str) -> datetime:
    # "2027-07-08 09:00": hora local del aeropuerto, igual que el modelo canónico (naive)
    return datetime.strptime(ts, "%Y-%m-%d %H:%M")


def normalize(itinerary: dict, provider: str, deeplink: str | None,
              fetched_at: datetime | None = None, bags: int = 0) -> FlightOffer | None:
    """Una opción de `best_flights`/`other_flights` -> `FlightOffer`. None si falta algo imprescindible."""
    segments = itinerary.get("flights") or []
    price = _minor(itinerary.get("price"))
    if not segments or price is None:
        return None
    first, last = segments[0], segments[-1]
    m = _FLIGHT_NO.match((first.get("flight_number") or "").strip())
    if m is None:
        return None
    try:
        depart, arrive = _local(first["departure_airport"]["time"]), _local(last["arrival_airport"]["time"])
        origin, destination = first["departure_airport"]["id"], last["arrival_airport"]["id"]
    except (KeyError, TypeError, ValueError):
        return None
    times = flight_times(origin, depart, destination, arrive)
    if times.duration_min is not None and times.duration_min <= 0:  # llega antes de salir: dato roto del proveedor
        report("flight_illogical_duration", "warning", provider=provider)
        return None
    numbers = "|".join((s.get("flight_number") or "").replace(" ", "") for s in segments)
    fee = bag_fee_per_bag_minor(m.group(1), origin, destination, bags)
    digest = hashlib.sha256(f"{origin}|{destination}|{depart.isoformat()}|{numbers}".encode()).hexdigest()[:16]
    return FlightOffer(
        id=f"{provider}:{digest}",
        provider=provider,
        origin=origin,
        destination=destination,
        depart_at=depart,
        arrive_at=arrive,
        depart_utc=times.depart_utc,
        arrive_utc=times.arrive_utc,
        duration_min=times.duration_min,
        stops=len(itinerary.get("layovers") or []),
        carrier=m.group(1),
        price_per_pax_minor=price,
        seats_available=SEATS_UNKNOWN,
        bag_fee_minor=fee or 0,
        bag_fee_known=fee is not None,
        deeplink=deeplink,
        fetched_at=fetched_at,
    )


def parse(data: dict, provider: str, fetched_at: datetime | None = None, bags: int = 0) -> list[FlightOffer]:
    """Respuesta completa -> ofertas canónicas, sin duplicados (una opción puede figurar en ambas listas)."""
    error = data.get("error")
    if error:
        if NO_RESULTS in str(error):
            return []
        raise UpstreamError(provider, 200, str(error)[:200])
    url = (data.get("search_metadata") or {}).get("google_flights_url")
    deeplink = url if isinstance(url, str) and url.startswith("https://") else None
    offers: dict[str, FlightOffer] = {}
    for it in [*(data.get("best_flights") or []), *(data.get("other_flights") or [])]:
        offer = normalize(it, provider, deeplink, fetched_at, bags)
        if offer is not None:
            offers.setdefault(offer.id, offer)
    return list(offers.values())


class SerpApiFlights:
    name = "serpapi_google_flights"
    URL = URL

    def __init__(
        self,
        api_key: str,
        client: httpx.AsyncClient,
        cache: Cache,
        stats: RequestStats | None = None,
        max_queries: int = 12,
        reserve: int = 0,
        bags: int = 0,
    ):
        self.api = SerpApi(self.name, api_key, client, cache, stats, reserve=reserve)
        self.max_queries, self.bags = max_queries, bags  # valijas por pasajero del viaje (tarifa publicada)

    @staticmethod
    def params(q: FlightQuery) -> dict:
        """Parámetros de la búsqueda SIN la clave: son también la clave de caché."""
        return {
            "engine": "google_flights",
            "type": 2,  # solo ida: cada tramo del plan se cotiza por separado
            "departure_id": ",".join(q.origins),
            "arrival_id": ",".join(q.destinations),
            "outbound_date": q.date.isoformat(),
            "adults": 1,
            "currency": "USD",
            "hl": "en",
            "gl": "us",
        }

    async def _search(self, q: FlightQuery) -> list[FlightOffer]:
        quote = await self.api.search(self.params(q), TTL_S["flights"])
        return parse(quote.data, self.name, quote.fetched_at, self.bags)

    async def pending(self, queries: list[FlightQuery]) -> int:
        """Cuántas búsquedas de este plan gastarían cuota (las que no están frescas en caché)."""
        todo = [q for q in queries if q.date >= date.today()]
        fresh = await asyncio.gather(*(self.api.is_fresh(self.params(q)) for q in todo))
        return sum(not f for f in fresh)

    async def flights(self, queries: list[FlightQuery]) -> list[FlightOffer]:
        # Las consultas del plan ya vienen deduplicadas; la fecha pasada nunca se cotiza.
        todo = [q for q in queries if q.date >= date.today()]
        if len(todo) > self.max_queries:
            raise FlightQuotaExceeded(self.name, len(todo), self.max_queries)
        results = await gather_partial(self.name, self.api.stats, [self._search(q) for q in todo])
        return [o for offers in results for o in offers]
