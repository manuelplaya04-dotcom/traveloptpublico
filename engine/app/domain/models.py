"""Modelo canónico. Todo proveedor (fixture o API real) se normaliza a estas clases.

Fuente única de verdad del contrato de datos: el frontend y n8n validan contra el
JSON Schema exportado desde aquí (ver scripts/export_contracts.py).
"""
from __future__ import annotations

import math
from datetime import date, datetime
from typing import Annotated, Literal
from urllib.parse import urlparse

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StrictBool, StringConstraints, model_validator

IATA = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]
CASE_KEY_PATTERN = r"^[a-z0-9_]{1,64}$"
CaseKey = Annotated[str, StringConstraints(pattern=CASE_KEY_PATTERN)]
CITY_NAME_PATTERN = r"^[\p{L} .'-]{1,40}$"


def _https(v: str | None) -> str | None:
    """Los deeplinks se renderizan como <a href>: solo https, con host y sin credenciales embebidas."""
    if v is None:
        return v
    u = urlparse(v)
    if u.scheme != "https" or not u.netloc or "@" in u.netloc:
        raise ValueError("deeplink debe ser una URL https sin credenciales")
    return v


Deeplink = Annotated[str | None, AfterValidator(_https)]

# Fotos: la web las sirve por su propio proxy (/api/photo), que solo acepta estos hosts. Fuera de la lista, sin foto.
PHOTO_HOSTS = frozenset({"lh3.googleusercontent.com", "lh4.googleusercontent.com", "lh5.googleusercontent.com",
                         "lh6.googleusercontent.com"})


def _photo(v: str | None) -> str | None:
    if v is None:
        return v
    _https(v)
    if urlparse(v).hostname not in PHOTO_HOSTS:
        raise ValueError("foto de un host no permitido")
    return v


PhotoUrl = Annotated[str | None, AfterValidator(_photo)]

# ---------------------------------------------------------------- entrada


class Constraints(BaseModel):
    min_bathrooms: int = Field(2, ge=0)
    min_bedrooms: int = Field(0, ge=0)
    max_stops: int = Field(1, ge=0)
    earliest_departure_hour: int = Field(6, ge=0, le=23)
    latest_arrival_hour: int = Field(23, ge=0, le=23)
    checked_bags_per_pax: int = Field(1, ge=0)
    allow_overnight_outbound: bool = True
    max_heavy_rain_prob: float = Field(0.5, ge=0, le=1)  # solo actividades outdoor
    max_tmax_c: float = 38.0  # solo actividades outdoor
    max_consecutive_full_days: int = Field(3, ge=1)
    activity_free_travel_days: bool = True
    # exigir cocina: solo pasa el alojamiento que la informa (kitchen=True); el que no la tiene o no la informa queda
    # afuera con su motivo en el embudo (no se supone que la tenga)
    require_kitchen: bool = False


class CityPlan(BaseModel):
    code: str = Field(pattern=r"^[A-Z]{2,5}$")  # "ORL", "NYC"
    # nombre para mostrar (lo usan los datos simulados); solo letras, espacios y . ' - : nada de marcado
    name: str | None = Field(None, pattern=CITY_NAME_PATTERN)
    airports: list[IATA] = Field(min_length=1, max_length=5)  # ["MCO"], ["JFK","LGA","EWR"]
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    min_nights: int = Field(ge=1, le=21)
    max_nights: int = Field(ge=1, le=21)
    # activity_key obligatorias en la ciudad
    must_do: list[Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,32}$")]] = Field([], max_length=10)

    @model_validator(mode="after")
    def _nights(self) -> "CityPlan":
        if self.max_nights < self.min_nights:
            raise ValueError(f"{self.code}: max_nights < min_nights")
        return self


NO_SERVICE_SELECTED = "Debes seleccionar al menos un servicio"


class Services(BaseModel):
    """Módulos que la persona quiere cotizar. Uno apagado = ya lo resolvió por su cuenta: no se busca, no se optimiza
    ni se suma al total. Booleanos estrictos (un "false" en texto no pasa) y sin campos de más."""
    model_config = ConfigDict(extra="forbid")

    flights: StrictBool = True
    lodging: StrictBool = True
    activities: StrictBool = True

    @model_validator(mode="after")
    def _at_least_one(self) -> "Services":
        if not (self.flights or self.lodging or self.activities):
            raise ValueError(NO_SERVICE_SELECTED)
        return self


class TripRequest(BaseModel):
    case_key: CaseKey | None = None
    # aeropuertos de salida: obligatorios solo si se cotizan vuelos
    origin_airports: list[IATA] = Field(default_factory=list, max_length=5)
    services: Services = Services()
    cities: list[CityPlan] = Field(min_length=1, max_length=4)
    fixed_order: bool = True
    first_checkin_from: date
    first_checkin_to: date
    total_nights_min: int = Field(ge=1, le=60)
    total_nights_max: int = Field(ge=1, le=60)
    pax: int = Field(ge=1, le=9)
    budget_minor: int = Field(ge=0, le=10**10)
    currency: Literal["USD"] = "USD"
    constraints: Constraints = Constraints()
    top_n: int = Field(3, ge=1, le=10)

    @model_validator(mode="after")
    def _window(self) -> "TripRequest":
        if self.services.flights and not self.origin_airports:
            raise ValueError("origin_airports: obligatorio para cotizar vuelos")
        if self.first_checkin_to < self.first_checkin_from:
            raise ValueError("first_checkin_to < first_checkin_from")
        if self.total_nights_max < self.total_nights_min:
            raise ValueError("total_nights_max < total_nights_min")
        days = (self.first_checkin_to - self.first_checkin_from).days + 1
        orders = 1 if self.fixed_order else math.factorial(len(self.cities))
        combos = days * orders * math.prod(c.max_nights - c.min_nights + 1 for c in self.cities)
        if days > 31 or combos > 20_000:
            raise ValueError("ventana de check-in o combinaciones de noches excesivas")
        return self


# ---------------------------------------------------------------- ofertas


class FlightOffer(BaseModel):
    kind: Literal["flight"] = "flight"
    id: str
    provider: str
    origin: str  # IATA aeropuerto
    destination: str
    depart_at: datetime  # hora LOCAL del aeropuerto de salida (naive)
    arrive_at: datetime  # hora LOCAL del aeropuerto de llegada (naive)
    # instantes reales y duración (app/domain/timezones.py); None = falta la zona de un aeropuerto o es dato de prueba.
    # Lo local sigue siendo la referencia para la interfaz y las reglas del optimizador.
    depart_utc: datetime | None = None
    arrive_utc: datetime | None = None
    duration_min: int | None = Field(None, gt=0)
    stops: int = Field(ge=0)
    carrier: str
    price_per_pax_minor: int = Field(ge=0)  # tarifa final con impuestos
    included_bags: int = Field(0, ge=0)  # valijas despachadas incluidas por pax
    bag_fee_minor: int = Field(0, ge=0)  # por valija extra y por pax
    bag_fee_known: bool = True  # False: el proveedor no lo informa ni hay tarifa publicada (no sumado al total)
    seats_available: int = Field(ge=0)
    deeplink: Deeplink = None
    fetched_at: datetime | None = None  # UTC: cuándo se cotizó en el proveedor real (None = dato de prueba)


class LodgingUnit(BaseModel):
    unit_type: str
    capacity: int = Field(ge=1)
    bedrooms: int = Field(ge=0)
    bathrooms: int = Field(ge=0)  # baños completos
    # explicit: lo informa el proveedor · inferred_per_room: habitación de hotel = 1 baño privado ·
    # inferred_minimum: alquiler que no informa baños; se toma el mínimo cierto (1) y la regla de baños hace el resto
    bathrooms_source: Literal["explicit", "inferred_per_room", "inferred_minimum"] = "explicit"
    available: int = Field(ge=0)
    base_total_minor: int = Field(ge=0)  # por unidad, estadía completa, sin impuestos
    fees_total_minor: int = Field(0, ge=0)  # resort/facility fee por unidad, estadía completa


class LodgingOffer(BaseModel):
    kind: Literal["lodging"] = "lodging"
    id: str
    provider: str
    city: str
    name: str
    check_in: date
    check_out: date
    units: list[LodgingUnit] = Field(min_length=1)
    stay_fee_minor: int = Field(0, ge=0)  # limpieza: una vez por reserva
    tax_bps: int = Field(0, ge=0)
    min_nights: int = Field(1, ge=1)
    short_term_legal: bool = True
    stars: int | None = Field(None, ge=1, le=5)  # categoría del establecimiento, si el proveedor la informa
    rating: float | None = Field(None, ge=0, le=10)  # puntuación de huéspedes (0 a 10), si el proveedor la informa
    lat: float | None = Field(None, ge=-90, le=90)  # ubicación, si el proveedor la informa (mapa y distancias)
    lon: float | None = Field(None, ge=-180, le=180)
    # comodidades tal como las informa el proveedor (texto plano; React las escapa)
    amenities: list[Annotated[str, StringConstraints(max_length=60)]] = Field([], max_length=12)
    # cocina o kitchenette: True = el proveedor la informa · False = publica sus comodidades y no figura (alquileres) ·
    # None = no se sabe (los hoteles traen solo un resumen de comodidades: que no figure no significa que no tenga)
    kitchen: bool | None = None
    photo_url: PhotoUrl = None  # miniatura del proveedor (solo hosts de PHOTO_HOSTS)
    deeplink: Deeplink = None
    fetched_at: datetime | None = None  # UTC: cuándo se cotizó en el proveedor real (None = dato de prueba)


class ActivityOffer(BaseModel):
    kind: Literal["activity"] = "activity"
    id: str
    provider: str
    city: str
    activity_key: str
    name: str
    date: date
    price_per_pax_minor: int = Field(ge=0)  # precio final
    outdoor: bool
    slots: int = Field(2, ge=1, le=2)  # 2 = día completo, 1 = medio día
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)
    deeplink: Deeplink = None
    # provider: precio del proveedor · curated: precio publicado (lista con fuente) · box_office: entrada no
    # publicada (paseo público o taquilla): se cuenta 0 y la web lo aclara, no es un precio inventado
    price_source: Literal["provider", "curated", "box_office"] = "provider"
    price_date_based: bool = False  # True: el precio varía por fecha y este es el mínimo publicado ("desde")


class WeatherDay(BaseModel):
    city: str
    date: date
    tmax_c: float
    heavy_rain_prob: float = Field(ge=0, le=1)  # P(precipitación >= 10 mm)
    source: str


class TransportQuote(BaseModel):
    kind: Literal["transport"] = "transport"
    id: str
    provider: str
    city: str
    mode: Literal["car_rental", "transfers"]
    per_day_minor: int = 0  # se multiplica por noches de la estadía
    per_trip_minor: int = 0
    trips: int = 0
    fixed_minor: int = 0
    tax_bps: int = 0
    deeplink: Deeplink = None


class OfferSet(BaseModel):
    flights: list[FlightOffer] = []
    lodging: list[LodgingOffer] = []
    activities: list[ActivityOffer] = []
    weather: list[WeatherDay] = []
    transport: list[TransportQuote] = []
