"""Actividades con datos reales para los modos hybrid y live: precios publicados (curados) + lugares de Wikidata.

- **Curadas** (`app/data/curated_activities_pricing.json`, validado con Pydantic al cargar): atracciones con precio
  publicado y fuente. Disney y Universal cobran por fecha: se usa el mínimo publicado (`date_based`, la web lo muestra
  como "desde"). `price_source="curated"`.
- **Lugares de Wikidata** que no están en la lista curada: se ofrecen con costo 0 y `price_source="box_office"`
  ("Paseo público / entrada sujeta a taquilla"): no se suma un monto que no conocemos y la web lo aclara. Si Wikidata no
  responde, quedan solo las curadas (las actividades no son críticas: la corrida sigue).

Las claves de las curadas son las mismas que usan el fixture y la web (MK, EPCOT, SOL…): los imperdibles siguen
funcionando. Ningún precio de esta clase es simulado.
"""
from __future__ import annotations

import json
import math
import re
import unicodedata
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.domain.models import ActivityOffer, Deeplink
from app.providers.places import places_near
from app.services.cache import Cache
from app.services.http import UpstreamError

PROVIDER = "precios_publicados"
PLACES_PROVIDER = "wikidata"
SAME_PLACE_KM = 0.4  # un lugar de Wikidata a menos de esto de una curada es la misma atracción
SAME_NAME_KM = 3.0  # o con el mismo nombre a menos de esto (un parque temático ocupa kilómetros)


class CuratedActivity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,32}$")]
    city: Annotated[str, StringConstraints(pattern=r"^[A-Z]{2,5}$")]
    name: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    price_from_usd: int = Field(gt=0, le=1000)
    date_based: bool
    outdoor: bool
    slots: Literal[1, 2]
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    link: Deeplink
    source: Deeplink  # de dónde sale el precio (auditable)


class CuratedCatalog(BaseModel):
    model_config = ConfigDict(extra="allow")  # admite "_comment"
    as_of: date
    activities: list[CuratedActivity] = Field(min_length=1)


@lru_cache(maxsize=1)
def catalog() -> CuratedCatalog:
    raw = json.loads((Path(__file__).parent.parent / "data" / "curated_activities_pricing.json").read_text("utf-8"))
    cat = CuratedCatalog.model_validate(raw)
    keys = [(a.city, a.key) for a in cat.activities]
    if len(keys) != len(set(keys)):
        raise ValueError("claves de actividades curadas repetidas")
    return cat


def _norm(name: str) -> str:
    """'Museo Metropolitano de Arte (The Met)' -> 'museo metropolitano de arte'; 'EPCOT (1 día)' -> 'epcot'."""
    base = re.sub(r"\(.*?\)", "", name)
    plain = unicodedata.normalize("NFKD", base).encode("ascii", "ignore").decode()
    return " ".join(plain.lower().split())


def _same(place: dict, a: CuratedActivity) -> bool:
    """Misma atracción: muy cerca, o cerca y con el mismo nombre ('Epcot') o uno contenido en el otro
    ('Universal Epic Universe' / 'Epic Universe')."""
    d = _km((place["lat"], place["lon"]), (a.lat, a.lon))
    if d < SAME_PLACE_KM:
        return True
    p, c = _norm(place["name"]), _norm(a.name)
    return d < SAME_NAME_KM and min(len(p), len(c)) >= 4 and (p == c or c in p or p in c)


def _km(a: tuple[float, float], b: tuple[float, float]) -> float:
    rad = math.radians
    h = math.sin(rad(b[0] - a[0]) / 2) ** 2 + math.cos(rad(a[0])) * math.cos(rad(b[0])) * math.sin(rad(b[1] - a[1]) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


class RealActivities:
    name = PROVIDER

    def __init__(self, coords: dict[str, tuple[float, float]], client: httpx.AsyncClient, cache: Cache):
        self.coords, self.client, self.cache = coords, client, cache

    async def _places(self, city: str) -> list[dict]:
        lat, lon = self.coords[city]
        try:
            return (await places_near(self.client, self.cache, lat, lon))["places"]
        except (UpstreamError, httpx.HTTPError):
            return []  # sin Wikidata: solo las curadas

    async def activities(self, city_days: list[tuple[str, date]]) -> list[ActivityOffer]:
        cities = sorted({c for c, _ in city_days if c in self.coords})
        curated = {c: [a for a in catalog().activities if a.city == c] for c in cities}
        places = {c: await self._places(c) for c in cities}
        out: list[ActivityOffer] = []
        for city, d in sorted(city_days):
            for a in curated.get(city, []):
                out.append(ActivityOffer(
                    id=f"{PROVIDER}:{a.key}@{d}", provider=PROVIDER, city=city, activity_key=a.key, name=a.name, date=d,
                    price_per_pax_minor=a.price_from_usd * 100, outdoor=a.outdoor, slots=a.slots, lat=a.lat, lon=a.lon,
                    deeplink=a.link, price_source="curated", price_date_based=a.date_based,
                ))
            for p in places.get(city, []):
                if any(_same(p, a) for a in curated.get(city, [])):
                    continue  # ya está como curada, con precio
                out.append(ActivityOffer(
                    id=f"{PLACES_PROVIDER}:{p['id']}@{d}", provider=PLACES_PROVIDER, city=city, activity_key=p["id"],
                    name=p["name"], date=d, price_per_pax_minor=0, outdoor=p["outdoor"], slots=1, lat=p["lat"],
                    lon=p["lon"], deeplink=p.get("link"), price_source="box_office",
                ))
        return out


class NoTransportQuotes:
    """Traslados en hybrid/live: no hay precios gratuitos de taxi o alquiler, así que no se cotizan (la web muestra
    tiempos reales por calle de OSRM). El optimizador lo registra como `sin_transporte:<ciudad>`."""

    name = "sin_cotizacion"

    async def transport(self, cities: list[str]) -> list:
        return []
