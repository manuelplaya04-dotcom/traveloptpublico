"""Eventos en la ciudad durante la estadía (Fase 4, base): información para elegir, no entra al optimizador.

Dos fuentes, cada una falla por su cuenta (si una cae, la otra sigue; si caen las dos, la web oculta la sección):

- **Ticketmaster Discovery API** (clave gratuita sin tarjeta, cuota propia de 5.000 pedidos/día): partidos,
  recitales y obras con fecha, hora, sede y rango de precios cuando el organizador lo publica. Consulta en vivo con
  caché de 6 h por ciudad y rango.
- **Google Events vía SerpApi**: NUNCA se consulta cuando alguien busca. Un cron semanal (`prefetch_google_events`)
  guarda una búsqueda por ciudad; las búsquedas de los usuarios leen esa caché (aunque esté vencida, con su fecha) y
  gastan 0 de la cuota de SerpApi. ~9 búsquedas al mes para Orlando y Nueva York.

Sin inventar datos: sin precio publicado no se muestra precio; Google Events da la fecha sin año ("Nov 9") y se toma
la próxima ocurrencia desde el día en que se guardó la búsqueda.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import UTC, date, datetime
from typing import Annotated, Literal

import httpx
from pydantic import BaseModel, Field, StringConstraints

from app.domain.models import Deeplink
from app.services.alerts import report
from app.services.cache import Cache, cache_key, cached_entry
from app.services.http import RequestStats, UpstreamError, fetch_json
from app.services.serpapi import URL as SERPAPI_URL
from app.services.serpapi import SerpApi

logger = logging.getLogger(__name__)

TM_URL = "https://app.ticketmaster.com/discovery/v2/events.json"
TM_TTL_S = 6 * 3600
GOOGLE_EVENTS_TTL_S = 6 * 86400  # el cron es semanal: a los 6 días ya está vencida y la renueva
_MONTHS = {m: i for i, m in enumerate(("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov",
                                        "Dec"), start=1)}

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Short = Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)]


class CityEvent(BaseModel):
    id: str
    source: Literal["ticketmaster", "google_events"]
    name: Text
    date: date
    time: Short | None = None  # hora local tal como la publica la fuente
    venue: Short | None = None
    category: Short | None = None
    price_min_minor: int | None = Field(None, ge=0)  # solo si la fuente publica precio en USD
    price_max_minor: int | None = Field(None, ge=0)
    link: Deeplink = None
    fetched_at: datetime
    lat: float | None = Field(None, ge=-90, le=90)  # ubicación del recinto, solo si la fuente la publica (Ticketmaster)
    lon: float | None = Field(None, ge=-180, le=180)


def _id(source: str, *parts: object) -> str:
    return f"{source}:{hashlib.sha256('|'.join(map(str, parts)).encode()).hexdigest()[:16]}"


def _coords(venue: object) -> tuple[float | None, float | None]:
    """latitude/longitude del recinto de Ticketmaster (vienen como texto). Ilegible o fuera de rango: sin ubicación."""
    loc = venue.get("location") if isinstance(venue, dict) else None
    try:
        lat, lon = float(loc["latitude"]), float(loc["longitude"])  # type: ignore[index]
    except (KeyError, TypeError, ValueError):
        return None, None
    ok = -90 <= lat <= 90 and -180 <= lon <= 180 and (lat, lon) != (0.0, 0.0)
    return (lat, lon) if ok else (None, None)


def _https(v: object) -> str | None:
    return v if isinstance(v, str) and v.startswith("https://") and len(v) <= 2048 else None


# ---------------------------------------------------------------- Ticketmaster


def parse_ticketmaster(data: dict, fetched_at: datetime) -> list[CityEvent]:
    out = []
    for e in (data.get("_embedded") or {}).get("events") or []:
        start = (e.get("dates") or {}).get("start") or {}
        try:
            day = date.fromisoformat(start.get("localDate") or "")
        except ValueError:
            continue
        name = e.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        prices = [p for p in e.get("priceRanges") or [] if isinstance(p, dict) and p.get("currency") == "USD"]
        lo = min((p["min"] for p in prices if isinstance(p.get("min"), (int, float))), default=None)
        hi = max((p["max"] for p in prices if isinstance(p.get("max"), (int, float))), default=None)
        venues = (e.get("_embedded") or {}).get("venues") or [{}]
        segment = ((e.get("classifications") or [{}])[0].get("segment") or {}).get("name")
        lat, lon = _coords(venues[0])
        out.append(CityEvent(
            id=_id("ticketmaster", e.get("id") or name, day), source="ticketmaster", name=name[:200], date=day,
            time=(start.get("localTime") or "")[:5] or None, venue=(venues[0].get("name") or None),
            category=segment if segment and segment != "Undefined" else None,
            price_min_minor=round(lo * 100) if lo is not None and lo >= 0 else None,
            price_max_minor=round(hi * 100) if hi is not None and hi >= 0 else None,
            link=_https(e.get("url")), fetched_at=fetched_at, lat=lat, lon=lon,
        ))
    return out


class TicketmasterEvents:
    name = "ticketmaster_discovery"

    def __init__(self, api_key: str, client: httpx.AsyncClient, cache: Cache, stats: RequestStats | None = None):
        self.api_key, self.client, self.cache, self.stats = api_key, client, cache, stats

    async def events(self, lat: float, lon: float, start: date, end: date) -> list[CityEvent]:
        params = {"latlong": f"{lat:.4f},{lon:.4f}", "radius": 40, "unit": "km", "size": 50, "sort": "date,asc",
                  "startDateTime": f"{start.isoformat()}T00:00:00Z", "endDateTime": f"{end.isoformat()}T23:59:59Z"}

        async def fetch() -> dict:
            return await fetch_json(self.client, "GET", TM_URL, provider=self.name, stats=self.stats,
                                    params={**params, "apikey": self.api_key})

        entry, _ = await cached_entry(self.cache, cache_key(self.name, TM_URL, params), self.name, TM_TTL_S, fetch)
        return parse_ticketmaster(entry.value, entry.fetched_at)


# ---------------------------------------------------------------- Google Events (pre-cargado)


def _next_occurrence(label: str, ref: date) -> date | None:
    """'Nov 9' -> la próxima fecha con ese mes y día desde `ref` (Google Events no publica el año)."""
    parts = label.split()
    if len(parts) != 2 or parts[0][:3] not in _MONTHS or not parts[1].isdigit():
        return None
    month, day = _MONTHS[parts[0][:3]], int(parts[1])
    for year in (ref.year, ref.year + 1):
        try:
            d = date(year, month, day)
        except ValueError:
            return None
        if d >= ref:
            return d
    return None


def parse_google_events(data: dict, fetched_at: datetime) -> list[CityEvent]:
    out = []
    for e in data.get("events_results") or []:
        when = (e.get("date") or {})
        day = _next_occurrence(str(when.get("start_date") or ""), fetched_at.date())
        title = e.get("title")
        if day is None or not isinstance(title, str) or not title.strip():
            continue
        text = str(when.get("when") or "")
        time = text.split(", ", 1)[1][:80] if ", " in text else None
        link = next((_https(t.get("link")) for t in e.get("ticket_info") or [] if _https(t.get("link"))), None)
        out.append(CityEvent(
            id=_id("google_events", title, day), source="google_events", name=title[:200], date=day, time=time,
            venue=((e.get("venue") or {}).get("name") or None), category=(e.get("type") or None),
            link=link, fetched_at=fetched_at,
        ))
    return out


def google_events_params(city_name: str) -> dict:
    """Parámetros de la búsqueda semanal (sin la clave): son también la clave de caché que leen los usuarios."""
    return {"engine": "google_events", "q": f"Events in {city_name}", "hl": "en", "gl": "us"}


async def cached_google_events(cache: Cache, city_name: str) -> list[CityEvent] | None:
    """Lo que guardó el cron, aunque esté vencido. None si nunca se pre-cargó. No toca la red ni la cuota."""
    e = await cache.entry(cache_key("serpapi_google_events", SERPAPI_URL, google_events_params(city_name)),
                          stale_ok=True)
    return None if e is None else parse_google_events(e.value, e.fetched_at)


async def prefetch_google_events(api: SerpApi, city_names: list[str]) -> dict[str, str]:
    """Cron semanal: una búsqueda por ciudad, con el mismo medidor y reserva de cuota que vuelos y hoteles."""
    async def one(name: str) -> str:
        try:
            q = await api.search(google_events_params(name), GOOGLE_EVENTS_TTL_S)
        except (UpstreamError, httpx.HTTPError) as exc:
            report("events_prefetch_failed", city=name, error=type(exc).__name__)
            return "error"
        return "historical" if q.stale else "ok"

    results = await asyncio.gather(*(one(n) for n in city_names))
    return dict(zip(city_names, results))


# ---------------------------------------------------------------- combinación para la web


async def events_for(city_name: str | None, lat: float, lon: float, start: date, end: date, cache: Cache,
                     ticketmaster: TicketmasterEvents | None, deadline_s: float = 4.0) -> dict:
    """Eventos de ambas fuentes entre `start` y `end`, cada fuente aislada (norma 4)."""
    sources: dict[str, str] = {}
    found: list[CityEvent] = []
    if ticketmaster is None:
        sources["ticketmaster"] = "not_configured"
    else:
        try:
            found += await asyncio.wait_for(ticketmaster.events(lat, lon, start, end), deadline_s)
            sources["ticketmaster"] = "ok"
        except (UpstreamError, httpx.HTTPError, ValueError, TimeoutError) as exc:  # ValueError: respuesta con forma inesperada
            report("ticketmaster_unavailable", error=type(exc).__name__)
            sources["ticketmaster"] = "unavailable"
    google = await cached_google_events(cache, city_name) if city_name else None
    sources["google_events"] = "no_data" if google is None else "ok"
    found += google or []
    in_range = {e.id: e for e in found if start <= e.date <= end}
    events = sorted(in_range.values(), key=lambda e: (e.date, e.time or "", e.name))
    return {"events": [e.model_dump(mode="json") for e in events[:40]], "sources": sources,
            "generated_at": datetime.now(UTC).isoformat()}

