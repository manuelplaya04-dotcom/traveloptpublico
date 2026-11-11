"""Eventos (Fase 4, base): Ticketmaster y Google Events pre-cargado, cada fuente aislada, sin red."""
import asyncio
import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx
import pytest

from app.providers.events import (
    TicketmasterEvents,
    cached_google_events,
    events_for,
    google_events_params,
    parse_google_events,
    parse_ticketmaster,
    prefetch_google_events,
)
from app.services import serpapi
from app.services.cache import MemoryCache, cache_key
from app.services.http import BREAKERS, RequestStats

GOOGLE = json.loads((Path(__file__).parent / "contracts" / "serpapi_google_events_orl.json").read_text("utf-8"))
SAVED = datetime(2026, 11, 3, 21, 0, tzinfo=UTC)  # día en que se grabó la respuesta real
DAY = date.today() + timedelta(days=30)
# Forma documentada de la Discovery API (developer.ticketmaster.com): se reemplaza por una real al cargar la clave.
TM = {"_embedded": {"events": [
    {"name": "Orlando Magic vs. Miami Heat", "id": "tm1", "url": "https://www.ticketmaster.com/event/tm1",
     "dates": {"start": {"localDate": DAY.isoformat(), "localTime": "19:00:00"}},
     "classifications": [{"segment": {"name": "Sports"}}],
     "priceRanges": [{"type": "standard", "currency": "USD", "min": 35.5, "max": 410.0}],
     "_embedded": {"venues": [{"name": "Kia Center", "location": {"latitude": "28.5392", "longitude": "-81.3839"}}]}},
    {"name": "Sin fecha", "id": "tm2", "dates": {"start": {}}},
    {"name": "Precio en otra moneda", "id": "tm3", "url": "http://inseguro.example",
     "dates": {"start": {"localDate": DAY.isoformat()}}, "priceRanges": [{"currency": "CAD", "min": 10, "max": 20}]},
]}}


@pytest.fixture(autouse=True)
def _fresh_breaker():
    BREAKERS.clear()
    yield
    BREAKERS.clear()


def test_google_events_reales_con_fecha_sin_anio_resuelta_desde_el_dia_guardado():
    events = parse_google_events(GOOGLE, SAVED)
    assert len(events) == 6
    first = next(e for e in events if e.name == "Chop & Play")
    assert first.date == date(2026, 11, 9) and first.time == "10:00 AM" and first.venue
    assert first.link.startswith("https://www.eventbrite.com/")
    jan = next(e for e in events if e.date.month == 1)
    assert jan.date.year == 2027  # enero ya pasó en 2026: es el del año siguiente
    assert all(e.price_min_minor is None for e in events)  # Google Events no publica precio: no se inventa


def test_ticketmaster_normaliza_precio_en_usd_y_descarta_lo_incompleto():
    events = parse_ticketmaster(TM, SAVED)
    assert [e.name for e in events] == ["Orlando Magic vs. Miami Heat", "Precio en otra moneda"]
    magic, other = events
    assert (magic.price_min_minor, magic.price_max_minor, magic.time, magic.venue, magic.category) == \
        (3550, 41000, "19:00", "Kia Center", "Sports")
    assert other.price_min_minor is None and other.link is None  # otra moneda y link no https: afuera
    assert (magic.lat, magic.lon) == (28.5392, -81.3839)  # "Ver en mapa" usa la ubicación publicada, sin geocodificar
    assert other.lat is None and other.lon is None


def test_ubicacion_ilegible_o_fuera_de_rango_queda_sin_coordenadas():
    from app.providers.events import _coords
    assert _coords({"location": {"latitude": "abc", "longitude": "1"}}) == (None, None)
    assert _coords({"location": {"latitude": "95", "longitude": "1"}}) == (None, None)
    assert _coords({"location": {"latitude": "0", "longitude": "0"}}) == (None, None)
    assert _coords({}) == (None, None) and _coords(None) == (None, None)


def _tm(handler):
    return TicketmasterEvents("tm-key", httpx.AsyncClient(transport=httpx.MockTransport(handler)), MemoryCache(),
                              RequestStats())


def test_si_ticketmaster_falla_siguen_los_eventos_guardados_de_google(monkeypatch):
    async def no_sleep(_):
        return None

    monkeypatch.setattr("app.services.http.asyncio.sleep", no_sleep)

    async def go():
        cache = MemoryCache()
        await cache.set(cache_key("serpapi_google_events", serpapi.URL, google_events_params("Orlando")), "x",
                        GOOGLE, -1)  # vencido: igual se usa, con su fecha
        tm = _tm(lambda r: httpx.Response(503))
        out = await events_for("Orlando", 28.5, -81.4, date(2026, 11, 1), date(2027, 3, 31), cache, tm)
        assert out["sources"] == {"ticketmaster": "unavailable", "google_events": "ok"} and out["events"]
        dates = [e["date"] for e in out["events"]]
        assert dates == sorted(dates)

    asyncio.run(go())


def test_sin_ninguna_fuente_devuelve_vacio_sin_romper():
    async def go():
        out = await events_for("Miami", 25.7, -80.2, DAY, DAY + timedelta(days=3), MemoryCache(), None)
        assert out["events"] == [] and out["sources"] == {"ticketmaster": "not_configured", "google_events": "no_data"}

    asyncio.run(go())


def test_ticketmaster_en_vivo_se_cachea_y_la_clave_no_entra_en_la_clave_de_cache():
    seen = []

    def handler(r):
        seen.append(dict(r.url.params))
        return httpx.Response(200, json=TM)

    async def go():
        tm = _tm(handler)
        a = await tm.events(28.5, -81.4, DAY, DAY + timedelta(days=4))
        b = await tm.events(28.5, -81.4, DAY, DAY + timedelta(days=4))
        assert a == b and len(seen) == 1 and seen[0]["apikey"] == "tm-key"
        assert all("tm-key" not in k for k in tm.cache._data)

    asyncio.run(go())


def test_la_busqueda_de_un_usuario_nunca_consulta_google_events():
    async def go():
        assert await cached_google_events(MemoryCache(), "Orlando") is None  # sin pre-carga: no hay, y no se pide

    asyncio.run(go())


def test_el_cron_respeta_la_reserva_de_cuota():
    calls = []

    async def go():
        serpapi.METER.left = 10  # por debajo de la reserva
        api = serpapi.SerpApi("serpapi_google_events", "k",
                              httpx.AsyncClient(transport=httpx.MockTransport(lambda r: calls.append(r))),
                              MemoryCache(), RequestStats(), reserve=20)
        assert await prefetch_google_events(api, ["Orlando", "New York"]) == {"Orlando": "error", "New York": "error"}
        assert calls == []

    asyncio.run(go())


def test_el_cron_guarda_una_busqueda_por_ciudad():
    calls = []

    def handler(r):
        calls.append(r.url.params["q"])
        return httpx.Response(200, json=GOOGLE)

    async def go():
        cache = MemoryCache()
        api = serpapi.SerpApi("serpapi_google_events", "k", httpx.AsyncClient(transport=httpx.MockTransport(handler)),
                              cache, RequestStats())
        assert await prefetch_google_events(api, ["Orlando"]) == {"Orlando": "ok"}
        assert calls == ["Events in Orlando"] and await cached_google_events(cache, "Orlando")

    asyncio.run(go())


def test_endpoint_de_eventos_valida_la_ventana(api):
    async def go():
        q = {"code": "ORL", "lat": 28.5, "lon": -81.4, "start": "2027-01-01", "end": "2027-06-01",
             "uid": "00000000-0000-4000-8000-0000000000aa"}
        bad = await api.get("/v1/events", params=q)
        ok = await api.get("/v1/events", params={**q, "end": "2027-01-05"})
        return bad.status_code, ok.status_code, ok.json()

    bad, ok, body = asyncio.run(go())
    assert bad == 422 and ok == 200 and body["events"] == []
