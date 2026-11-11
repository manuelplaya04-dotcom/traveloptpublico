"""Lugares reales para visitar (Wikidata, gratis y sin clave; ubicación de OpenStreetMap/Wikidata).

Una consulta SPARQL por ciudad: museos, parques, plazas, monumentos, puentes, parques temáticos, zoológicos y
teatros a menos de 15 km del centro, ordenados por relevancia (cantidad de Wikipedias que los cubren). Se guarda 30
días en la caché; si Wikidata no responde, se sirve el último resultado guardado aunque esté vencido. No usa SerpApi:
la cuota queda para vuelos y hoteles.

Sin inventar datos: Wikidata no publica precios de entrada, así que estos lugares se muestran como información (con
link a Wikipedia) y **no entran al optimizador ni al total**.
"""
from __future__ import annotations

import re

import httpx
from pydantic import BaseModel

from app.domain.models import Deeplink
from app.services.alerts import report
from app.services.cache import Cache, cache_key, cached_entry
from app.services.http import RequestStats, UpstreamError, fetch_json

SPARQL_URL = "https://query.wikidata.org/sparql"
PROVIDER = "wikidata_sparql"
USER_AGENT = "TravelOpt/1.0 (+https://travelopt-rho.vercel.app)"
TTL_S = 30 * 86400
LIMIT = 16

# tipo de Wikidata -> (etiqueta, al aire libre), en orden de prioridad: un lugar suele tener varios tipos (la Estatua
# de la Libertad es monumento y mirador) y se muestra el primero de esta lista.
TYPES: dict[str, tuple[str, bool]] = {
    "Q4989906": ("Monumento", True), "Q207694": ("Museo de arte", False), "Q33506": ("Museo", False),
    "Q2416723": ("Parque temático", True), "Q194195": ("Parque de diversiones", True), "Q43501": ("Zoológico", True),
    "Q2281788": ("Acuario", False), "Q22746": ("Parque urbano", True), "Q22698": ("Parque", True),
    "Q174782": ("Plaza", True), "Q12280": ("Puente", True), "Q24354": ("Teatro", False), "Q483453": ("Fuente", True),
    "Q1440300": ("Mirador", True), "Q570116": ("Atracción turística", True),
}
_PRIORITY = {q: i for i, q in enumerate(TYPES)}
# Cerrados que Wikidata no marca con ninguna propiedad de cierre (verificado el 2026-11-04). Lista mínima: si Wikidata
# lo corrige, sobra.
CLOSED_QIDS = frozenset({"Q2777866"})  # DisneyQuest (Disney Springs, cerró en 2017)
_POINT = re.compile(r"^Point\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$")
_QID = re.compile(r"^http://www\.wikidata\.org/entity/(Q\d+)$")


class Place(BaseModel):
    id: str  # QID de Wikidata
    name: str
    kind: str
    outdoor: bool
    lat: float
    lon: float
    link: Deeplink = None  # Wikipedia en español, o la ficha de Wikidata
    relevance: int  # cantidad de Wikipedias que lo cubren


def query(lat: float, lon: float, radius_km: int = 15) -> str:
    types = " ".join(f"wd:{q}" for q in TYPES)
    return f"""SELECT ?item ?itemLabel ?coord ?sitelinks ?type ?article WHERE {{
  SERVICE wikibase:around {{ ?item wdt:P625 ?coord . bd:serviceParam wikibase:center "Point({lon} {lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "{radius_km}" . }}
  VALUES ?type {{ {types} }}
  ?item wdt:P31 ?type ; wikibase:sitelinks ?sitelinks .
  FILTER NOT EXISTS {{ ?item wdt:P576 ?cerrado }}   # disuelto o demolido (p. ej. DisneyQuest): no se recomienda
  FILTER NOT EXISTS {{ ?item wdt:P3999 ?cierre }}   # fecha de cierre oficial
  FILTER NOT EXISTS {{ ?item wdt:P582 ?fin }}       # fecha de fin (p. ej. Pleasure Island, 2008)
  OPTIONAL {{ ?article schema:about ?item ; schema:isPartOf <https://es.wikipedia.org/> . }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "es,en". }}
}} ORDER BY DESC(?sitelinks) LIMIT 60"""


def parse(data: dict) -> list[Place]:
    best: dict[str, Place] = {}
    ranks: dict[str, int] = {}
    for b in (data.get("results") or {}).get("bindings") or []:
        qid = _QID.match((b.get("item") or {}).get("value", ""))
        point = _POINT.match((b.get("coord") or {}).get("value", ""))
        type_id = _QID.match((b.get("type") or {}).get("value", ""))
        name = (b.get("itemLabel") or {}).get("value", "")
        if not (qid and point and type_id) or type_id.group(1) not in TYPES or not name or name == qid.group(1):
            continue  # sin etiqueta legible Wikidata devuelve el QID: se descarta
        if qid.group(1) in CLOSED_QIDS:
            continue
        kind, outdoor = TYPES[type_id.group(1)]
        article = (b.get("article") or {}).get("value")
        try:
            relevance = int((b.get("sitelinks") or {}).get("value", "0"))
        except ValueError:
            continue
        type_rank = _PRIORITY[type_id.group(1)]
        place = Place(id=qid.group(1), name=name[:120], kind=kind, outdoor=outdoor, lat=float(point.group(2)),
                      lon=float(point.group(1)), relevance=relevance,
                      link=article if isinstance(article, str) and article.startswith("https://")
                      else f"https://www.wikidata.org/wiki/{qid.group(1)}")
        if place.id not in best or type_rank < ranks[place.id]:
            best[place.id], ranks[place.id] = place, type_rank
    return sorted(best.values(), key=lambda p: (-p.relevance, p.name))[:LIMIT]


async def places_near(client: httpx.AsyncClient, cache: Cache, lat: float, lon: float,
                      stats: RequestStats | None = None) -> dict:
    """{"places": [...], "fetched_at", "stale"} o UpstreamError si Wikidata no responde y no hay nada guardado."""
    params = {"lat": round(lat, 3), "lon": round(lon, 3)}
    key = cache_key(PROVIDER, SPARQL_URL, params)

    async def fetch() -> dict:
        return await fetch_json(client, "GET", SPARQL_URL, provider=PROVIDER, stats=stats,
                                params={"query": query(lat, lon), "format": "json"},
                                headers={"User-Agent": USER_AGENT, "Accept": "application/sparql-results+json"})

    try:
        entry, _ = await cached_entry(cache, key, PROVIDER, TTL_S, fetch)
        stale = False
    except (UpstreamError, httpx.HTTPError) as exc:
        old = await cache.entry(key, stale_ok=True)
        if old is None:
            raise
        report("wikidata_stale", error=type(exc).__name__)
        entry, stale = old, True
    return {"places": [p.model_dump(mode="json") for p in parse(entry.value)],
            "fetched_at": entry.fetched_at.isoformat(), "stale": stale, "source": "Wikidata"}
