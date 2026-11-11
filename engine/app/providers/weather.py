"""Clima: pronóstico (OpenWeather One Call 3.0, horizonte <= 7 días) + climatología histórica.

La climatología se calcula con N años de historia diaria y una ventana de ±W días alrededor de
la fecha objetivo (N*(2W+1) muestras): P(lluvia >= heavy_mm) y tmax media.
Open-Meteo devuelve 10 años en UNA llamada por ciudad; OpenWeather day_summary requeriría
una llamada por fecha y año. Por eso la climatología usa Open-Meteo por defecto.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

import httpx

from app.domain.models import WeatherDay
from app.services.cache import TTL_S, Cache, cache_key, cached
from app.services.http import RequestStats, fetch_json

HEAVY_RAIN_MM = 10.0


def _same_day(year: int, d: date) -> date:
    try:
        return d.replace(year=year)
    except ValueError:  # 29/02 en año no bisiesto
        return date(year, 2, 28)


def climatology(
    city: str,
    target: date,
    history: dict[date, tuple[float | None, float | None]],
    years: range,
    window_days: int,
    heavy_mm: float,
    source: str,
) -> WeatherDay:
    tmax: list[float] = []
    wet = n = 0
    for y in years:
        center = _same_day(y, target)
        for off in range(-window_days, window_days + 1):
            sample = history.get(center + timedelta(days=off))
            if sample is None:
                continue
            tx, precip = sample
            if tx is not None:
                tmax.append(tx)
            if precip is not None:
                n += 1
                wet += precip >= heavy_mm
    if n == 0 or not tmax:
        raise ValueError(f"sin historia climática para {city} {target}")
    return WeatherDay(
        city=city,
        date=target,
        tmax_c=round(sum(tmax) / len(tmax), 1),
        heavy_rain_prob=round(wet / n, 3),
        source=f"{source}:{years.start}-{years.stop - 1}",
    )


class OpenMeteoClimatology:
    name = "open_meteo_climatology"
    URL = "https://archive-api.open-meteo.com/v1/archive"

    def __init__(
        self,
        coords: dict[str, tuple[float, float]],
        client: httpx.AsyncClient,
        cache: Cache,
        stats: RequestStats | None = None,
        years: int = 10,
        window_days: int = 3,
        today: date | None = None,
    ):
        self.coords, self.client, self.cache, self.stats = coords, client, cache, stats
        self.window_days = window_days
        last = (today or date.today()).year - 1
        self.years = range(last - years + 1, last + 1)

    async def history(self, city: str) -> dict[date, tuple[float | None, float | None]]:
        lat, lon = self.coords[city]
        params = {
            "latitude": round(lat, 4),
            "longitude": round(lon, 4),
            "start_date": date(self.years.start, 1, 1).isoformat(),
            "end_date": date(self.years.stop - 1, 12, 31).isoformat(),
            "daily": "temperature_2m_max,precipitation_sum",
            "timezone": "auto",
        }
        data, hit = await cached(
            self.cache,
            cache_key(self.name, self.URL, params),
            self.name,
            TTL_S["weather_history"],
            lambda: fetch_json(self.client, "GET", self.URL, provider=self.name, stats=self.stats, params=params),
        )
        if hit and self.stats is not None:
            self.stats.cache_hits += 1
        d = data["daily"]
        return {
            date.fromisoformat(t): (tx, p)
            for t, tx, p in zip(d["time"], d["temperature_2m_max"], d["precipitation_sum"])
        }

    async def weather(self, city_days: list[tuple[str, date]]) -> list[WeatherDay]:
        by_city: dict[str, list[date]] = defaultdict(list)
        for city, d in city_days:
            by_city[city].append(d)
        cities = list(by_city)
        histories = await asyncio.gather(*(self.history(c) for c in cities))
        return [
            climatology(city, d, hist, self.years, self.window_days, HEAVY_RAIN_MM, self.name)
            for city, hist in zip(cities, histories)
            for d in by_city[city]
        ]


class OpenWeatherForecast:
    name = "openweather_onecall"
    URL = "https://api.openweathermap.org/data/3.0/onecall"
    HORIZON_DAYS = 7

    def __init__(self, api_key: str, coords, client, cache: Cache, stats: RequestStats | None = None):
        self.api_key, self.coords, self.client, self.cache, self.stats = api_key, coords, client, cache, stats

    async def _daily(self, city: str) -> dict[date, WeatherDay]:
        lat, lon = self.coords[city]
        params = {"lat": round(lat, 4), "lon": round(lon, 4), "exclude": "current,minutely,hourly,alerts", "units": "metric"}
        data, hit = await cached(
            self.cache,
            cache_key(self.name, self.URL, params),  # la key de cache NO incluye appid
            self.name,
            TTL_S["weather_forecast"],
            lambda: fetch_json(
                self.client, "GET", self.URL, provider=self.name, stats=self.stats,
                params={**params, "appid": self.api_key},
            ),
        )
        if hit and self.stats is not None:
            self.stats.cache_hits += 1
        offset = data.get("timezone_offset", 0)
        out = {}
        for day in data.get("daily", []):
            d = datetime.fromtimestamp(day["dt"] + offset, tz=timezone.utc).date()
            pop, rain = float(day.get("pop", 0.0)), float(day.get("rain", 0.0))
            # Heurística documentada: P(>=10 mm) ~ pop si el acumulado esperado ya supera el umbral.
            heavy = pop if rain >= HEAVY_RAIN_MM else pop * rain / HEAVY_RAIN_MM
            out[d] = WeatherDay(
                city=city, date=d, tmax_c=float(day["temp"]["max"]),
                heavy_rain_prob=round(min(1.0, heavy), 3), source=self.name,
            )
        return out

    async def weather(self, city_days: list[tuple[str, date]]) -> list[WeatherDay]:
        out: list[WeatherDay] = []
        for city in sorted({c for c, _ in city_days}):
            daily = await self._daily(city)
            out.extend(daily[d] for c, d in city_days if c == city and d in daily)
        return out


class CompositeWeather:
    """Pronóstico para fechas cercanas; climatología para el resto (y como respaldo)."""

    name = "weather_composite"

    def __init__(self, climatology_provider, forecast_provider=None, today: date | None = None):
        self.clim, self.forecast = climatology_provider, forecast_provider
        self.today = today or date.today()

    async def weather(self, city_days: list[tuple[str, date]]) -> list[WeatherDay]:
        horizon = self.today + timedelta(days=OpenWeatherForecast.HORIZON_DAYS)
        near = [(c, d) for c, d in city_days if d <= horizon] if self.forecast else []
        got = await self.forecast.weather(near) if near else []
        covered = {(w.city, w.date) for w in got}
        rest = [(c, d) for c, d in city_days if (c, d) not in covered]
        return got + (await self.clim.weather(rest) if rest else [])


# ---------------------------------------------------------------- detalle para la UI ("Ver más" del clima)


def history_by_year(
    history: dict[date, tuple[float | None, float | None]], start: date, end: date, years: range, heavy_mm: float = HEAVY_RAIN_MM
) -> list[dict]:
    """Para cada año de la historia, el mismo tramo de calendario [start, end): tmax media y máxima, días con lluvia
    fuerte y lluvia total. Es lo que alimenta la climatología, mostrado año por año."""
    rows = []
    span = (end - start).days
    for y in years:
        first = _same_day(y, start)
        samples = [history.get(first + timedelta(days=i)) for i in range(span)]
        tmax = [s[0] for s in samples if s and s[0] is not None]
        precip = [s[1] for s in samples if s and s[1] is not None]
        if not tmax or not precip:
            continue
        rows.append({
            "year": y,
            "tmax_avg_c": round(sum(tmax) / len(tmax), 1),
            "tmax_max_c": round(max(tmax), 1),
            "heavy_rain_days": sum(p >= heavy_mm for p in precip),
            "precip_total_mm": round(sum(precip), 1),
            "days": len(precip),
        })
    return rows


class OpenMeteoForecast:
    """Pronóstico diario de los próximos días (Open-Meteo, sin clave). Informativo: el optimizador no lo usa para
    fechas lejanas; para eso está CompositeWeather con su horizonte."""

    name = "open_meteo_forecast"
    URL = "https://api.open-meteo.com/v1/forecast"

    def __init__(self, client: httpx.AsyncClient, cache: Cache, stats: RequestStats | None = None):
        self.client, self.cache, self.stats = client, cache, stats

    async def daily(self, lat: float, lon: float, days: int = 7) -> list[dict]:
        params = {
            "latitude": round(lat, 4),
            "longitude": round(lon, 4),
            "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max",
            "forecast_days": days,
            "timezone": "auto",
        }
        data, _ = await cached(
            self.cache,
            cache_key(self.name, self.URL, params),
            self.name,
            TTL_S["weather_forecast"],
            lambda: fetch_json(self.client, "GET", self.URL, provider=self.name, stats=self.stats, params=params),
        )
        d = data["daily"]
        return [
            {"date": t, "tmax_c": tx, "tmin_c": tn, "precip_mm": p, "precip_prob": pp}
            for t, tx, tn, p, pp in zip(
                d["time"], d["temperature_2m_max"], d["temperature_2m_min"],
                d["precipitation_sum"], d["precipitation_probability_max"],
            )
        ]
