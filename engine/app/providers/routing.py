"""Distancias y tiempos reales por calle (OSRM, servidor público del proyecto OpenStreetMap; gratis y sin clave).

Una consulta `table` por alojamiento: del alojamiento a cada destino (aeropuertos y actividades) en auto. La red de
calles casi no cambia, así que cada combinación se guarda **para siempre** en la caché (`api_cache`, sin vencimiento):
JFK → un hotel de Manhattan se consulta una sola vez para todos los usuarios. La política del servidor público pide
poco tráfico: limitador de 1 pedido por segundo, User-Agent identificado y coordenadas redondeadas (~1 m) para
maximizar aciertos de caché. Si OSRM no responde, la web vuelve a su estimación en línea recta, marcada como estimada.
Solo logística (tiempo y distancia): no hay precios de taxi o auto gratuitos y no se inventan.
"""
from __future__ import annotations

import httpx

from app.services.cache import Cache, cache_key, cached
from app.services.http import RequestStats, UpstreamError, fetch_json

OSRM_URL = "https://router.project-osrm.org/table/v1/driving/"
PROVIDER = "osrm_public"
USER_AGENT = "TravelOpt/1.0 (+https://travelopt-rho.vercel.app)"
MAX_DESTINATIONS = 25

Point = tuple[float, float]  # (lat, lon)


def _r(p: Point) -> Point:
    return round(p[0], 5), round(p[1], 5)


async def route_table(client: httpx.AsyncClient, cache: Cache, origin: Point, destinations: list[Point],
                      stats: RequestStats | None = None) -> list[dict | None]:
    """[{distance_m, duration_s} | None por destino] en auto desde `origin` (None: OSRM no encontró ruta)."""
    if not destinations:
        return []
    if len(destinations) > MAX_DESTINATIONS:
        raise ValueError(f"máximo {MAX_DESTINATIONS} destinos")
    o, ds = _r(origin), [_r(d) for d in destinations]
    coords = ";".join(f"{lon},{lat}" for lat, lon in (o, *ds))
    params = {"sources": 0, "annotations": "duration,distance"}

    async def fetch() -> dict:
        data = await fetch_json(client, "GET", OSRM_URL + coords, provider=PROVIDER, stats=stats, params=params,
                                headers={"User-Agent": USER_AGENT})
        if data.get("code") != "Ok":
            raise UpstreamError(PROVIDER, 200, str(data.get("code"))[:50])  # no se cachea
        return {"durations": data["durations"][0], "distances": data["distances"][0]}

    data, hit = await cached(cache, cache_key(PROVIDER, OSRM_URL, {"o": o, "d": ds}), PROVIDER, None, fetch)
    if hit and stats is not None:
        stats.cache_hits += 1
    out: list[dict | None] = []
    for dur, dist in zip(data["durations"][1:], data["distances"][1:]):
        ok = isinstance(dur, (int, float)) and isinstance(dist, (int, float))
        out.append({"distance_m": round(dist), "duration_s": round(dur)} if ok else None)
    return out
