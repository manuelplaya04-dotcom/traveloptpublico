"""Proveedor simulado: genera ofertas canónicas para CUALQUIER ciudad y fecha a partir del pedido.

Cubre lo que el fixture no tiene (otras ciudades, otras fechas, otro orden) para que la demo responda a lo que la
persona carga. Las ciudades que el fixture conoce (ORL, NYC) siguen usando sus alojamientos, actividades, clima
y traslados, y los vuelos del fixture cuando existen para esa ruta y fecha; el resto se genera. Distancias reales entre aeropuertos, noches, viajeros y estación del año cambian precios, horarios,
alojamientos y clima. Los datos son ficticios y se marcan como tales (`provider="simulado"`, clima `demo:simulado`).

Determinístico (invariante del motor): cada valor sale de un generador sembrado con SHA-256 de su clave (ruta+fecha,
ciudad+estadía, ...), nunca de `hash()` (que cambia entre procesos) ni del reloj. Misma entrada, misma salida.
"""
from __future__ import annotations

import hashlib
import math
import random
from collections import Counter
from datetime import date, datetime, timedelta
from urllib.parse import quote_plus
from zoneinfo import ZoneInfo

from app.domain.models import (
    ActivityOffer,
    FlightOffer,
    LodgingOffer,
    LodgingUnit,
    TransportQuote,
    TripRequest,
    WeatherDay,
)
from app.optimizer.skeletons import FlightQuery, Stay
from app.providers.fixture import FixtureProvider

# Orígenes del catálogo de la web (los destinos traen sus coordenadas en el pedido).
ORIGIN_COORDS: dict[str, tuple[float, float]] = {"EZE": (-34.8222, -58.5358), "AEP": (-34.5592, -58.4156)}
# Huso horario por aeropuerto: los horarios de vuelo son locales en origen y destino (como en una API real).
# Aeropuerto sin huso conocido: se asume el mismo huso que el de origen (no se inventa una diferencia horaria).
AIRPORT_TZ = {
    **dict.fromkeys(("EZE", "AEP"), "America/Argentina/Buenos_Aires"),
    **dict.fromkeys(("JFK", "LGA", "EWR", "MCO", "MIA", "PHL", "BOS", "IAD", "DCA"), "America/New_York"),
    **dict.fromkeys(("ORD", "MDW"), "America/Chicago"),
    **dict.fromkeys(("CDG", "ORY"), "Europe/Paris"), **dict.fromkeys(("FCO", "CIA"), "Europe/Rome"),
    **dict.fromkeys(("HND", "NRT"), "Asia/Tokyo"), "SYD": "Australia/Sydney", "SCL": "America/Santiago",
}


def _utc_offset_h(airport: str, day: date) -> float | None:
    tz = AIRPORT_TZ.get(airport)
    if tz is None:
        return None
    off = datetime.combine(day, datetime.min.time(), tzinfo=ZoneInfo(tz)).utcoffset()
    return off.total_seconds() / 3600 if off is not None else None


CARRIERS = ("AR", "LA", "CM", "AA", "UA", "DL", "AF", "IB", "AV")
DRY_SHARE = 0.8  # al menos ~80% de los días del clima simulado respetan la tolerancia de lluvia del pedido


def _rng(*key: object) -> random.Random:
    seed = hashlib.sha256("|".join(map(str, key)).encode()).digest()
    return random.Random(int.from_bytes(seed[:8], "big"))


def _km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distancia de gran círculo (haversine)."""
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def _near(center: tuple[float, float], *key: object, km: tuple[float, float]) -> tuple[float, float]:
    """Punto determinístico a una distancia (rango en km) y rumbo derivados de la clave, alrededor de `center`."""
    r = _rng("pos", *key)
    d, bearing = r.uniform(*km), r.uniform(0, 2 * math.pi)
    lat = center[0] + (d / 111.0) * math.cos(bearing)
    lon = center[1] + (d / (111.0 * math.cos(math.radians(center[0])))) * math.sin(bearing)
    return round(lat, 5), round(lon, 5)


def _usd(x: float) -> int:
    """Dólares → centavos, redondeado a dólar entero (precios de vidriera)."""
    return round(x) * 100


class SyntheticProvider:
    name = "simulado"

    def __init__(self, req: TripRequest, fixture: FixtureProvider | None = None):
        self.fixture = fixture
        self.known = {c.code for c in fixture.trip_request().cities} if fixture else set()
        self.pax = req.pax
        self.max_rain, self.max_tmax = req.constraints.max_heavy_rain_prob, req.constraints.max_tmax_c
        self.city_name = {c.code: c.name or c.code for c in req.cities}
        self.city_coords = {c.code: (c.lat, c.lon) for c in req.cities}
        self.city_airports = {c.code: c.airports for c in req.cities}
        self.airport_coords = dict(ORIGIN_COORDS)
        for c in req.cities:
            self.airport_coords.update({a: (c.lat, c.lon) for a in c.airports})
        # nivel de precios de cada ciudad (0.8 a 1.5), estable por código
        self.cost = {c.code: 0.8 + 0.7 * _rng("costo", c.code).random() for c in req.cities}

    # ------------------------------------------------------------ vuelos
    async def flights(self, queries: list[FlightQuery]) -> list[FlightOffer]:
        known = await self.fixture.flights(queries) if self.fixture else []
        have = {(f.origin, f.destination, f.depart_at.date()) for f in known}
        return known + [f for q in queries for o in q.origins for d in q.destinations
                        if (o, d, q.date) not in have for f in self._route(o, d, q.date)]

    def _route(self, origin: str, dest: str, day: date) -> list[FlightOffer]:
        a, b = self.airport_coords.get(origin), self.airport_coords.get(dest)
        if not a or not b or origin == dest:  # sin coordenadas no se inventa una distancia: esa ruta no tiene oferta
            return []
        km = _km(a, b)
        r = _rng("vuelo", origin, dest, day)
        weekend = 1.1 if day.weekday() >= 4 else 1.0
        o_off, d_off = _utc_offset_h(origin, day), _utc_offset_h(dest, day)
        shift = d_off - o_off if o_off is not None and d_off is not None else 0.0  # horas que se "ganan" o pierden
        out = []
        # mañana (llega en el día), mediodía (puede llegar de madrugada), nocturno (llega al día siguiente) y un
        # directo más caro de media mañana: con "sin escalas" siempre hay alguna opción, como en una ruta real.
        for i, depart_h in enumerate((6.5, 12.0, 21.5, 10.0)):
            direct = i == 3
            stops = 0 if direct or km < 2_500 or (i == 0 and km < 6_000) else 1
            hours = km / 780 + 0.6 + 2.2 * stops
            depart_h += r.randint(0, 3) / 4
            depart = datetime.combine(day, datetime.min.time()) + timedelta(hours=depart_h)
            if i == 0:  # el vuelo de la mañana siempre llega el mismo día (hora local) antes de las 23
                hours = min(hours, 22.75 - depart_h - shift)
            arrive = depart + timedelta(hours=round(hours * 4) / 4 + shift)  # hora local del destino
            price = (55 + 0.075 * km) * (1.15 - 0.12 * stops) * (1.3 if direct else 1) * weekend * r.uniform(0.85, 1.3)
            bags = 1 if r.random() < 0.6 else 0
            out.append(FlightOffer(
                id=f"S-{origin}{dest}-{day:%m%d}-{i}", provider=self.name, origin=origin, destination=dest,
                depart_at=depart, arrive_at=arrive, stops=stops, carrier=r.choice(CARRIERS),
                price_per_pax_minor=_usd(price), included_bags=bags, bag_fee_minor=0 if bags else _usd(45),
                seats_available=self._seats(r),
                deeplink=f"https://www.google.com/travel/flights?q=Flights%20from%20{origin}%20to%20{dest}%20on%20{day}",
            ))
        return out

    def _seats(self, r: random.Random) -> int:
        """Casi siempre hay lugar de sobra; a veces quedan pocos, pero alcanzan para el grupo (como en una API real,
        un vuelo sin lugar para el grupo directamente no se ofrece)."""
        return 9 if r.random() < 0.75 else r.randint(self.pax, min(9, self.pax + 2))

    # ------------------------------------------------------------ alojamiento
    async def lodging(self, stays: list[Stay]) -> list[LodgingOffer]:
        known = [st for st in stays if st.city in self.known]
        # ORL/NYC fuera del caso de prueba: los alojamientos del fixture MÁS los simulados (más opciones para elegir)
        own = [o for st in stays if st.city in self.cost for o in self._stay(st)]
        offers = (await self.fixture.lodging(known) if self.fixture and known else []) + own
        return calibrate_min_stay(offers)

    def _stay(self, st: Stay) -> list[LodgingOffer]:
        name, k = self.city_name[st.city], self.cost[st.city]
        r = _rng("aloj", st.city, st.check_in, st.check_out)
        n = st.nights
        unit = lambda t, cap, bed, bath, avail, usd, src="explicit", fee=0: LodgingUnit(  # noqa: E731
            unit_type=t, capacity=cap, bedrooms=bed, bathrooms=bath, bathrooms_source=src, available=avail,
            base_total_minor=_usd(usd * k * r.uniform(0.9, 1.1)) * n, fees_total_minor=_usd(fee) * n)
        room = "inferred_per_room"
        # (id, nombre, unidades, limpieza USD, noches mínimas, estrellas): de lo más económico a lo más caro
        props = [
            ("A", f"Hostel {name} Centro · habitaciones privadas", [unit("Habitación privada (4)", 4, 1, 1, 3, 52, room)], 0, 1, None),
            ("E", f"Hotel 2★ económico · {name}", [unit("Habitación triple", 3, 1, 1, 4, 68, room, 6)], 0, 1, 2),
            ("F", f"Hotel 3★ {name} Estación", [unit("Habitación doble", 2, 1, 1, 6, 74, room, 10),
                                               unit("Habitación cuádruple", 4, 1, 1, 3, 108, room, 10)], 0, 1, 3),
            ("D", f"Apart 2 dorm. (1 baño) · {name}", [unit("Apart completo", 5, 2, 1, 1, 120)], 60, 3, None),
            ("G", f"Departamento 2 dorm. y 2 baños · {name}", [unit("Departamento completo", 5, 2, 2, 1, 138)], 70, 2, None),
            ("B", f"Departamento 3 dorm. en el centro de {name}", [unit("Departamento completo", 6, 3, 2, 1, 165)], 90, 2, None),
            ("C", f"Hotel 4★ {name} Centro", [unit("Habitación doble", 2, 1, 1, 6, 115, room, 18),
                                              unit("Suite familiar", 4, 1, 1, 3, 205, room, 18)], 0, 1, 4),
            ("H", f"Casa 4 dorm. con patio · {name}", [unit("Casa completa", 10, 4, 3, 1, 240)], 150, 4, None),
        ]
        search = (f"https://www.booking.com/searchresults.html?ss={quote_plus(name)}"
                  f"&checkin={st.check_in}&checkout={st.check_out}&group_adults={self.pax}")
        return [
            LodgingOffer(
                id=f"S{st.city}{pid}@{st.check_in}/{st.check_out}", provider=self.name, city=st.city, name=title,
                check_in=st.check_in, check_out=st.check_out, units=units, stay_fee_minor=_usd(fee * k),
                tax_bps=1200, min_nights=min_n, short_term_legal=True, stars=stars,
                **dict(zip(("lat", "lon"), _near(self.city_coords[st.city], st.city, pid, km=(0.3, 4.0)))),
                rating=round(_rng("puntaje", st.city, pid).uniform(7.0, 9.5), 1), deeplink=search,
            )
            for pid, title, units, fee, min_n, stars in props
        ]

    # ------------------------------------------------------------ actividades
    async def activities(self, city_days: list[tuple[str, date]]) -> list[ActivityOffer]:
        known = [cd for cd in city_days if cd[0] in self.known]
        fixture = await self.fixture.activities(known) if self.fixture and known else []
        # catálogo simulado en todas las ciudades (también ORL/NYC, sumado a sus imperdibles). Sin partidos: no hay
        # calendario real gratuito y está prohibido inventar fechas (los deportes son información estática en la web).
        return fixture + self._activities(city_days)

    def _activities(self, city_days: list[tuple[str, date]]) -> list[ActivityOffer]:
        catalog = (  # clave, nombre, al aire libre, slots, USD por persona
            ("TOUR", "City tour por {n}", True, 1, 45),
            ("WALK", "Free walking tour por el casco histórico de {n}", True, 1, 0),
            ("MUSEO", "Museo principal de {n}", False, 1, 30),
            ("ARTE", "Galería de arte contemporáneo de {n}", False, 1, 18),
            ("MIRA", "Mirador panorámico de {n}", True, 1, 25),
            ("COMIDA", "Tour gastronómico por mercados de {n}", True, 1, 65),
            ("BICI", "Recorrido en bicicleta por {n}", True, 1, 35),
            ("BARCO", "Paseo en barco por {n}", True, 1, 40),
            ("EXCUR", "Excursión de día completo desde {n}", True, 2, 95),
            ("PARQUE", "Parque temático o de aventura cerca de {n}", True, 2, 85),
            ("SHOW", "Espectáculo nocturno en {n}", False, 1, 70),
            ("COCINA", "Clase de cocina local en {n}", False, 1, 55),
        )
        out = []
        # La duración total del catálogo de una ciudad (2 slots = 1 día) no supera los días disponibles de la estadía.
        days_by_city = Counter(city for city, _ in city_days)
        fitting: dict[str, list[tuple[str, str, bool, int, int]]] = {}
        for city, days in days_by_city.items():
            budget, fitting[city] = 2 * days, []
            for item in catalog:
                if item[3] <= budget:
                    fitting[city].append(item)
                    budget -= item[3]
        for city, d in city_days:
            if city not in self.cost:
                continue
            name, k = self.city_name[city], self.cost[city]
            weekend = 1.1 if d.weekday() >= 5 else 1.0
            for key, title, outdoor, slots, usd in fitting[city]:
                label = title.format(n=name)
                out.append(ActivityOffer(
                    id=f"{city}-{key}@{d}", provider=self.name, city=city, activity_key=f"{city}-{key}", name=label,
                    **dict(zip(("lat", "lon"), _near(self.city_coords[city], city, key,
                                                     km=(15.0, 35.0) if slots == 2 else (0.5, 8.0)))),
                    date=d, price_per_pax_minor=_usd(usd * k * weekend), outdoor=outdoor, slots=slots,
                    deeplink=f"https://www.getyourguide.com/s/?q={quote_plus(label)}",
                ))
        return out

    # ------------------------------------------------------------ clima
    async def weather(self, city_days: list[tuple[str, date]]) -> list[WeatherDay]:
        # También para ORL/NYC fuera del caso de prueba: el clima del fixture es plano (30% de lluvia todos los días)
        # y con una tolerancia baja no dejaba ningún día para los parques al aire libre.
        out = []
        for city, d in city_days:
            if city not in self.city_coords:
                continue
            lat = self.city_coords[city][0]
            # climatología aproximada: más frío lejos del ecuador, estaciones invertidas en el hemisferio sur
            season = math.cos(2 * math.pi * (d.month - 7) / 12) * (1 if lat >= 0 else -1)
            r = _rng("clima", city, d)
            tmax = 31 - 0.38 * abs(lat) + 0.22 * abs(lat) * season + r.uniform(-2.5, 2.5)
            # lluvia fuerte: la mayoría de los días secos (mediana ~15%, 4 de cada 10 por debajo del 10%), algunos de tormenta
            rain = round(0.6 * r.random() ** 2, 2)
            if rain > self.max_rain and r.random() < DRY_SHARE:  # calibrado: la tolerancia del pedido se cumple casi siempre
                rain = round(self.max_rain * r.random(), 2)
            out.append(WeatherDay(city=city, date=d, tmax_c=round(min(tmax, self.max_tmax - 1), 1),
                                  heavy_rain_prob=rain, source="demo:simulado"))
        return out

    # ------------------------------------------------------------ traslados
    async def transport(self, cities: list[str]) -> list[TransportQuote]:
        known = await self.fixture.transport([c for c in cities if c in self.known]) if self.fixture else []
        return known + [
            TransportQuote(
                id=f"S-T-{c}", provider=self.name, city=c, mode="transfers", per_trip_minor=_usd(40 * self.cost[c]),
                trips=2, deeplink=(f"https://www.google.com/maps/dir/?api=1&origin={self.city_airports[c][0]}+Airport"
                                   f"&destination={quote_plus(self.city_name[c])}"),
            )
            for c in cities if c in self.cost and c not in self.known
        ]


MIN_STAY_SHARE = 0.8  # al menos el 80% de los alojamientos de una estadía aceptan esa cantidad de noches


def calibrate_min_stay(offers: list[LodgingOffer]) -> list[LodgingOffer]:
    """Estadía mínima coherente con lo pedido: por estadía, como máximo el 20% de las propiedades (las de mínimo
    más alto, como una casa que se alquila por semana) conserva un mínimo mayor que las noches; el resto se ajusta."""
    by_stay: dict[tuple[str, date, date], list[LodgingOffer]] = {}
    for o in offers:
        by_stay.setdefault((o.city, o.check_in, o.check_out), []).append(o)
    out = []
    for (_, ci, co), group in by_stay.items():
        nights = (co - ci).days
        keep = int(len(group) * (1 - MIN_STAY_SHARE))  # cuántas pueden exigir más noches
        strict = sorted(group, key=lambda o: (-o.min_nights, o.id))[:keep]
        out += [o if o in strict or o.min_nights <= nights else o.model_copy(update={"min_nights": nights}) for o in group]
    return out


def fixture_covers(req: TripRequest, fixture_req: TripRequest) -> bool:
    """El fixture solo sirve para su propio caso: mismo recorrido (ciudades y orden), dentro de su ventana de fechas
    y con noches dentro de los rangos del caso. Fuera de eso, datos simulados calibrados al pedido."""
    nights_ok = all(f.min_nights <= c.min_nights and c.max_nights <= f.max_nights
                    for c, f in zip(req.cities, fixture_req.cities))
    return (
        nights_ok
        and [c.code for c in req.cities] == [c.code for c in fixture_req.cities]
        and req.origin_airports == fixture_req.origin_airports
        and fixture_req.first_checkin_from <= req.first_checkin_from
        and req.first_checkin_to <= fixture_req.first_checkin_to
    )
