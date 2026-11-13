"""Alojamiento real: SerpApi (motor `google_hotels`), misma cuenta y cuota que los vuelos (ver app/services/serpapi.py).

Adapter puro: traduce cada propiedad al modelo canónico (`LodgingOffer`). Por estadía (ciudad, check-in, check-out):

- una búsqueda de **hoteles** con `adults=2`: el precio es el de una habitación estándar y la clave de caché no
  depende del grupo (dos búsquedas de la misma ciudad y fechas comparten la consulta);
- si el grupo es de 3 o más, una búsqueda de **alquileres temporarios** (`vacation_rentals`) con `adults=pax`, donde
  una sola unidad suele alojar a todos.

Decisiones del contrato (ver docs/adr/0001-proveedores.md), sin inventar datos:
- Precio: `total_rate` es la estadía completa. Base = antes de impuestos; impuestos y cargos = después − antes, como
  cargo de la unidad (sin tasa propia: ya vienen calculados). Así el total cotizado concilia al centavo.
- Habitación de hotel: Google no informa baños ni cupo. Una habitación estándar tiene 1 baño privado
  (`inferred_per_room`) y se ofrecen las habitaciones que el grupo necesita (de a 2 huéspedes); el cupo se confirma al
  reservar, como los asientos de un vuelo.
- Alquiler: capacidad, dormitorios y baños salen de `essential_info` ("Sleeps 6", "3 bedrooms", "1 bathroom"). Sin
  "Sleeps N" la opción se descarta. Sin baños informados se toma el mínimo cierto (1, `inferred_minimum`): la regla de
  baños mínimos lo descarta si pedís 2 o más, en vez de suponer que cumple.
- Legalidad: Nueva York (Local Law 18) prohíbe alquilar una vivienda completa por menos de 30 noches. Los alquileres
  de NYC y Brooklyn por menos de 30 noches se marcan no legales y el embudo los descarta con ese motivo. En otras
  ciudades no hay una regla verificada y el alquiler se toma como publicado legalmente (limitación registrada).
"""
from __future__ import annotations

import asyncio
import hashlib
import math
import re
from datetime import date, datetime
from urllib.parse import urlsplit

import httpx

from app.domain.models import PHOTO_HOSTS, LodgingOffer, LodgingUnit
from app.optimizer.skeletons import Stay
from app.domain.legal import SEED_RULES, LegalRules
from app.services.cache import TTL_S, Cache
from app.services.http import RequestStats, UpstreamError
from app.services.serpapi import NO_RESULTS, SerpApi, gather_partial

ROOM_GUESTS = 2  # huéspedes por habitación estándar (la búsqueda de hoteles se hace con adults=2)
RENTALS_FROM_PAX = 3  # desde este tamaño de grupo también se buscan alquileres temporarios

_SLEEPS = re.compile(r"^Sleeps (\d+)$")
_BEDROOMS = re.compile(r"^(\d+) bedrooms?$")
_BATHROOMS = re.compile(r"^(\d+)(?:\.\d+)? bathrooms?$")


class LodgingQuotaExceeded(UpstreamError):
    """La corrida pediría más búsquedas de alojamiento que el tope configurado: se corta antes de gastar cuota."""

    def __init__(self, provider: str, needed: int, cap: int):
        super().__init__(provider, None, f"la corrida necesita {needed} búsquedas de alojamiento y el tope es {cap}")


def _int(v: object) -> int | None:
    return v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else None


def _price(p: dict) -> tuple[int, int] | None:
    """(base, impuestos y cargos) en centavos para toda la estadía, o None si no hay precio total."""
    total = p.get("total_rate") or {}
    before, after = _int(total.get("extracted_before_taxes_fees")), _int(total.get("extracted_lowest"))
    if after is None:
        return None
    if before is None or before > after:
        return after * 100, 0  # sin desglose: el total final queda como base
    return before * 100, (after - before) * 100


def _info(p: dict, pattern: re.Pattern) -> int | None:
    for item in p.get("essential_info") or []:
        m = pattern.match(str(item).strip())
        if m:
            return int(m.group(1))
    return None


def _rental_unit(p: dict, base: int, fees: int) -> LodgingUnit | None:
    sleeps = _info(p, _SLEEPS)
    if not sleeps:
        return None
    baths = _info(p, _BATHROOMS)
    kind = next((str(i) for i in p.get("essential_info") or [] if str(i).startswith("Entire ")), "Alquiler completo")
    return LodgingUnit(unit_type=kind, capacity=sleeps, bedrooms=_info(p, _BEDROOMS) or 0,
                       bathrooms=baths if baths is not None else 1,
                       bathrooms_source="explicit" if baths is not None else "inferred_minimum",
                       available=1, base_total_minor=base, fees_total_minor=fees)


def _photo(p: dict) -> str | None:
    """Primera miniatura servida por Google (los originales vienen de decenas de CDN de terceros: se descartan)."""
    for im in p.get("images") or []:
        url = im.get("thumbnail") if isinstance(im, dict) else None
        if isinstance(url, str) and url.startswith("https://") and urlsplit(url).hostname in PHOTO_HOSTS:
            return url
    return None


# "Kitchen", "Kitchenette", "Full kitchen", "Cocina"… y nada más (no "Kitchen-style restaurant" ni utensilios sueltos)
KITCHEN = re.compile(r"^(?:full |shared |private )?(?:kitchen|kitchenette|cocina(?: equipada)?)$", re.IGNORECASE)


def kitchen(amenities: object, rental: bool) -> bool | None:
    """Sobre la lista COMPLETA (antes del recorte a 12). Los alquileres publican su lista de comodidades: si existe y
    no figura, no tiene (False). Los hoteles traen un resumen: si no figura, no se sabe (None), nunca False."""
    items = [a.strip() for a in amenities if isinstance(a, str)] if isinstance(amenities, list) else []
    if any(KITCHEN.match(a) for a in items):
        return True
    return False if rental and items else None


def normalize(p: dict, stay: Stay, provider: str, pax: int, fallback_link: str | None,
              fetched_at: datetime | None = None, legal: LegalRules = SEED_RULES) -> LodgingOffer | None:
    """Una propiedad de `properties` -> `LodgingOffer`. None si falta algo imprescindible (precio, nombre, capacidad)."""
    name, price = p.get("name"), _price(p)
    if not isinstance(name, str) or not name.strip() or price is None:
        return None
    base, fees = price
    rental = p.get("type") == "vacation rental"
    if rental:
        unit = _rental_unit(p, base, fees)
        if unit is None:
            return None
    else:
        unit = LodgingUnit(unit_type=f"Habitación estándar ({ROOM_GUESTS} huéspedes)", capacity=ROOM_GUESTS,
                           bedrooms=1, bathrooms=1, bathrooms_source="inferred_per_room",
                           available=math.ceil(pax / ROOM_GUESTS), base_total_minor=base, fees_total_minor=fees)
    gps = p.get("gps_coordinates") or {}
    lat, lon = gps.get("latitude"), gps.get("longitude")
    valid_gps = isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and -90 <= lat <= 90 \
        and -180 <= lon <= 180
    stars = _int(p.get("extracted_hotel_class"))
    rating = p.get("overall_rating")
    link = p.get("link")
    ref = p.get("property_token") or name
    digest = hashlib.sha256(f"{stay.city}|{stay.check_in}|{stay.check_out}|{ref}".encode()).hexdigest()[:16]
    return LodgingOffer(
        id=f"{provider}:{digest}",
        provider=provider,
        city=stay.city,
        name=name.strip()[:120],
        check_in=stay.check_in,
        check_out=stay.check_out,
        units=[unit],
        short_term_legal=not rental or legal.rental_allowed(stay.city, stay.nights),
        stars=stars if stars is not None and 1 <= stars <= 5 else None,
        rating=round(min(10.0, rating * 2), 1) if isinstance(rating, (int, float)) and rating >= 0 else None,
        lat=lat if valid_gps else None,
        lon=lon if valid_gps else None,
        photo_url=_photo(p),
        amenities=[a.strip() for a in p.get("amenities") or [] if isinstance(a, str) and 0 < len(a.strip()) <= 60][:12],
        kitchen=kitchen(p.get("amenities"), rental),
        deeplink=link if isinstance(link, str) and link.startswith("https://") else fallback_link,
        fetched_at=fetched_at,
    )


def parse(data: dict, stay: Stay, provider: str, pax: int, fetched_at: datetime | None = None,
          legal: LegalRules = SEED_RULES) -> list[LodgingOffer]:
    error = data.get("error")
    if error:
        if NO_RESULTS in str(error):
            return []
        raise UpstreamError(provider, 200, str(error)[:200])
    url = (data.get("search_metadata") or {}).get("google_hotels_url")
    fallback = url if isinstance(url, str) and url.startswith("https://") else None
    offers = (normalize(p, stay, provider, pax, fallback, fetched_at, legal) for p in data.get("properties") or [])
    return [o for o in offers if o is not None]


class SerpApiHotels:
    name = "serpapi_google_hotels"

    def __init__(
        self,
        api_key: str,
        client: httpx.AsyncClient,
        cache: Cache,
        stats: RequestStats | None,
        city_names: dict[str, str],
        pax: int,
        max_queries: int = 8,
        reserve: int = 0,
        rentals: bool = True,
        legal: LegalRules = SEED_RULES,
    ):
        self.api = SerpApi(self.name, api_key, client, cache, stats, reserve=reserve)
        self.legal = legal
        self.city_names, self.pax, self.max_queries = city_names, pax, max_queries
        self.rentals = rentals and pax >= RENTALS_FROM_PAX  # False: recorte de cuota (solo hoteles)

    def params(self, stay: Stay, rentals: bool) -> dict:
        """Parámetros SIN la clave: son también la clave de caché."""
        return {
            "engine": "google_hotels",
            "q": self.city_names.get(stay.city, stay.city),
            "check_in_date": stay.check_in.isoformat(),
            "check_out_date": stay.check_out.isoformat(),
            "adults": self.pax if rentals else ROOM_GUESTS,
            "currency": "USD",
            "hl": "en",
            "gl": "us",
            **({"vacation_rentals": "true"} if rentals else {}),
        }

    async def _search(self, stay: Stay, rentals: bool) -> list[LodgingOffer]:
        quote = await self.api.search(self.params(stay, rentals), TTL_S["lodging"])
        return parse(quote.data, stay, self.name, self.pax, quote.fetched_at, self.legal)

    def _todo(self, stays: list[Stay]) -> list[tuple[Stay, bool]]:
        modes = (False, True) if self.rentals else (False,)
        return [(st, r) for st in stays if st.check_in >= date.today() for r in modes]

    async def pending(self, stays: list[Stay]) -> int:
        """Cuántas búsquedas de este plan gastarían cuota (las que no están frescas en caché)."""
        fresh = await asyncio.gather(*(self.api.is_fresh(self.params(st, r)) for st, r in self._todo(stays)))
        return sum(not f for f in fresh)

    async def lodging(self, stays: list[Stay]) -> list[LodgingOffer]:
        todo = self._todo(stays)
        if len(todo) > self.max_queries:
            raise LodgingQuotaExceeded(self.name, len(todo), self.max_queries)
        results = await gather_partial(self.name, self.api.stats, [self._search(st, r) for st, r in todo])
        offers: dict[str, LodgingOffer] = {}  # una propiedad puede salir en ambas búsquedas
        for o in (o for batch in results for o in batch):
            offers.setdefault(o.id, o)
        return list(offers.values())
