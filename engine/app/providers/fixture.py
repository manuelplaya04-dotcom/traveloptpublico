"""Proveedor fixture: materializa ofertas canónicas del caso de prueba hardcodeado.

Implementa las cinco interfaces de providers/base.py, así el resto del sistema no distingue
entre datos de prueba y datos en vivo. Los archivos viven en engine/fixtures/<case_key>/.
"""
from __future__ import annotations

import json
import re
from datetime import date
from functools import lru_cache
from pathlib import Path

from app.domain.models import (
    CASE_KEY_PATTERN,
    ActivityOffer,
    FlightOffer,
    LodgingOffer,
    LodgingUnit,
    TransportQuote,
    TripRequest,
    WeatherDay,
)
from app.optimizer.skeletons import FlightQuery, Stay

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures"


class FixtureProvider:
    name = "fixture"

    def __init__(self, case_key: str):
        if not re.fullmatch(CASE_KEY_PATTERN, case_key):
            raise ValueError("case_key inválido")
        d = (FIXTURES_DIR / case_key).resolve()
        if not d.is_dir() or not d.is_relative_to(FIXTURES_DIR):
            raise ValueError("case_key inválido")
        self.dir = d
        self._flights = [FlightOffer(**r) for r in self._load("flights.json")]
        self._properties = self._load("lodging.json")
        self._activities = self._load("activities.json")
        self._weather = self._load("weather.json")
        self._transport = [TransportQuote(**r) for r in self._load("transport.json")]

    def _load(self, name: str):
        return json.loads((self.dir / name).read_text(encoding="utf-8"))

    def trip_request(self) -> TripRequest:
        return TripRequest.model_validate(self._load("trip_request.json"))

    async def flights(self, queries: list[FlightQuery]) -> list[FlightOffer]:
        keys = {(o, d, q.date) for q in queries for o in q.origins for d in q.destinations}
        return [f for f in self._flights if (f.origin, f.destination, f.depart_at.date()) in keys]

    async def lodging(self, stays: list[Stay]) -> list[LodgingOffer]:
        out = []
        for st in stays:
            for p in self._properties:
                if p["city"] != st.city:
                    continue
                units = [
                    LodgingUnit(
                        unit_type=u["unit_type"],
                        capacity=u["capacity"],
                        bedrooms=u["bedrooms"],
                        bathrooms=u["bathrooms"],
                        bathrooms_source=u.get("bathrooms_source", "explicit"),
                        available=u["available"],
                        base_total_minor=u["nightly_minor"] * st.nights,
                        fees_total_minor=u.get("per_night_fee_minor", 0) * st.nights,
                    )
                    for u in p["units"]
                ]
                out.append(
                    LodgingOffer(
                        id=f"{p['id']}@{st.check_in}/{st.check_out}",
                        provider=self.name,
                        city=st.city,
                        name=p["name"],
                        check_in=st.check_in,
                        check_out=st.check_out,
                        units=units,
                        stay_fee_minor=p.get("stay_fee_minor", 0),
                        tax_bps=p["tax_bps"],
                        min_nights=p.get("min_nights", 1),
                        short_term_legal=p.get("short_term_legal", True),
                        lat=p.get("lat"),
                        lon=p.get("lon"),
                        deeplink=p.get("deeplink"),
                    )
                )
        return out

    async def activities(self, city_days: list[tuple[str, date]]) -> list[ActivityOffer]:
        out = []
        for city, d in city_days:
            for a in self._activities:
                if a["city"] != city or d.isoformat() in a.get("closed_dates", []):
                    continue
                weekend = a.get("weekend_premium_minor", 0) if d.weekday() >= 5 else 0
                out.append(
                    ActivityOffer(
                        id=f"{a['key']}@{d}",
                        provider=self.name,
                        city=city,
                        activity_key=a["key"],
                        name=a["name"],
                        date=d,
                        price_per_pax_minor=a["base_minor"] + weekend,
                        outdoor=a["outdoor"],
                        slots=a["slots"],
                        lat=a.get("lat"),
                        lon=a.get("lon"),
                        deeplink=a.get("deeplink"),
                    )
                )
        return out

    async def weather(self, city_days: list[tuple[str, date]]) -> list[WeatherDay]:
        out = []
        for city, d in city_days:
            spec = self._weather.get(city)
            if spec is None:
                continue
            values = {**spec["default"], **spec.get("overrides", {}).get(d.isoformat(), {})}
            out.append(WeatherDay(city=city, date=d, source=spec["source"], **values))
        return out

    async def transport(self, cities: list[str]) -> list[TransportQuote]:
        return [q for q in self._transport if q.city in cities]


@lru_cache(maxsize=16)
def get_fixture(case_key: str) -> FixtureProvider:
    """FixtureProvider compartido: sus datos son de solo lectura, así se leen del disco una sola vez."""
    return FixtureProvider(case_key)
