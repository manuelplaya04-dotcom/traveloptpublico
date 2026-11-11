"""Asesor de momento óptimo: clasificación robusta (percentiles), cold start y endpoint por dueño."""
import asyncio
from datetime import UTC, datetime, timedelta

from app.domain.models import FlightOffer
from app.optimizer.price_advice import MIN_SNAPSHOTS, PriceStats, classify, percentiles

STATS = PriceStats(snapshots=5, observations=40, p20=18000.0, median=30000.0, p80=42000.0)


# ---------------------------------------------------------------- clasificación (unitarios aislados)


def test_cold_start_sin_historial_suficiente_no_aconseja():
    assert classify(10000, None) is None
    assert classify(10000, PriceStats(MIN_SNAPSHOTS - 1, 200, 1.0, 2.0, 3.0)) is None  # muchas ofertas, poca historia
    assert classify(10000, PriceStats(0, 0, None, None, None)) is None


def test_precio_bajo_es_oportunidad():
    assert classify(18000, STATS) == "opportunity"  # justo en el percentil 20
    assert classify(9900, STATS) == "opportunity"


def test_precio_alto_es_esperar():
    assert classify(42000, STATS) == "wait"
    assert classify(99999, STATS) == "wait"


def test_precio_en_el_medio_es_estandar():
    assert classify(30000, STATS) == "standard" and classify(18001, STATS) == "standard"


def test_un_precio_anomalo_no_mueve_la_mediana():
    normal = [30000] * 9
    _, med, _ = percentiles(normal + [9_999_900])  # un precio absurdo
    assert med == 30000  # el promedio daría 1,026,990: la mediana no se rompe


def test_percentiles_iguales_a_postgres():
    # mismos datos que supabase/tests/database/flight_price_stats.test.sql: 100..500 USD
    assert percentiles([10000, 20000, 30000, 40000, 50000]) == (18000.0, 30000.0, 42000.0)


# ---------------------------------------------------------------- endpoint (repositorio en memoria)

OWNER = "00000000-0000-4000-8000-0000000000aa"
DAY = (datetime.now() + timedelta(days=60)).replace(hour=9, minute=0, second=0, microsecond=0)


def _flight(i: int, price: int, at: datetime, provider="serpapi_google_flights") -> FlightOffer:
    return FlightOffer(id=f"f{i}", provider=provider, origin="MCO", destination="JFK", depart_at=DAY,
                       arrive_at=DAY + timedelta(hours=3), stops=0, carrier="B6", price_per_pax_minor=price,
                       seats_available=9, fetched_at=at)


def _seed(api, snapshots: int) -> str:
    from app.api.main import app
    from app.providers.fixture import FixtureProvider

    async def go():
        repo, req = app.state.repo, FixtureProvider("orlando_nyc_5pax").trip_request()
        rid = ""
        for s in range(snapshots):  # una corrida por momento de cotización, con 5 precios cada una
            rid = await repo.create_run(req, "hybrid", OWNER)
            at = datetime.now(UTC) - timedelta(days=s)
            await repo.upsert_offers(rid, "flights", [_flight(i, 10000 * (i + 1), at) for i in range(5)])
        await repo.upsert_offers(rid, "flights", [_flight(9, 1, datetime.now(UTC), provider="simulado")])
        return rid

    return asyncio.run(go())


def test_endpoint_aconseja_con_historia_y_oculta_en_cold_start(api):
    async def get(rid, uid=OWNER):
        return await api.get(f"/v1/runs/{rid}/price-advice", params={"uid": uid})

    cold = _seed(api, snapshots=2)
    assert asyncio.run(get(cold)).json() == {"advice": {}}  # 2 momentos: sin consejo

    warm = _seed(api, snapshots=2)  # suma 2 momentos más de la misma ruta: ahora hay historia
    advice = asyncio.run(get(warm)).json()["advice"]
    assert advice["f0"]["advice"] == "opportunity" and advice["f4"]["advice"] == "wait"
    assert advice["f2"]["advice"] == "standard" and "f9" not in advice  # el dato simulado no se aconseja
    assert asyncio.run(get(warm, uid="00000000-0000-4000-8000-0000000000bb")).status_code == 404  # BOLA
