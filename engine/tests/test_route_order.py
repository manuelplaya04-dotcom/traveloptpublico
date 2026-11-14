"""Ruta óptima (orden libre) y margen mínimo de ida.

Con `fixed_order: false` el motor prueba todos los órdenes de visita (permutaciones de hasta 4 ciudades) y CP-SAT
elige el más barato; el desempate sigue siendo explícito (total, id del esqueleto), así que es determinístico. Si las
búsquedas pagas no alcanzan, el orden libre es lo último que se resigna (`quota_narrowed: ["…", "order"]`).
"""
import asyncio
import uuid
from datetime import UTC, date, datetime, timedelta

from app.api.main import MIN_LEAD_DAYS, too_soon
from app.domain.models import TripRequest
from app.optimizer.skeletons import build_query_plan, generate_skeletons
from app.optimizer.solver import optimize
from app.providers.base import collect_offers
from app.providers.synthetic import SyntheticProvider
from app.services.quota_plan import STEPS, applicable_steps, effective_request, narrow
from tests.test_synthetic import BASE, PAR, ROM, _req

MAD = dict(code="MAD", name="Madrid", airports=["MAD"], lat=40.4168, lon=-3.7038, must_do=[])


def _three(**patch) -> TripRequest:
    cities = [{**c, "min_nights": n, "max_nights": n} for c, n in ((PAR, 3), (ROM, 3), (MAD, 2))]
    return _req(cities, case_key=None, first_checkin_from="2027-05-10", first_checkin_to="2027-05-10", **patch)


def _solve(req: TripRequest, engine: str = "cpsat"):
    # Mismas ofertas para el orden fijo y el libre: se cotiza el plan del orden libre, que contiene al fijo.
    free = req.model_copy(update={"fixed_order": False})
    offers = asyncio.run(collect_offers(build_query_plan(free, generate_skeletons(free)), SyntheticProvider(free)))
    return optimize(req, offers, engine)  # type: ignore[arg-type]


# ---------------------------------------------------------------- orden libre


def test_orden_libre_prueba_todas_las_permutaciones():
    assert len({s.order for s in generate_skeletons(_three(fixed_order=False))}) == 6
    assert {s.order for s in generate_skeletons(_three())} == {("PAR", "ROM", "MAD")}


def test_orden_libre_nunca_es_mas_caro_que_el_elegido_y_coincide_con_la_fuerza_bruta():
    fixed = _solve(_three()).itineraries[0]
    free = _three(fixed_order=False)
    best, brute = _solve(free).itineraries[0], _solve(free, "brute").itineraries[0]
    assert best.total_minor < fixed.total_minor  # con estos datos, otro orden (PAR-MAD-ROM) ahorra ~USD 700
    assert (best.total_minor, best.skeleton.id) == (brute.total_minor, brute.skeleton.id)


def test_orden_libre_es_deterministico():
    free = _three(fixed_order=False)
    assert _solve(free).itineraries[0].skeleton.id == _solve(free).itineraries[0].skeleton.id


def test_cuota_el_orden_es_lo_ultimo_que_se_resigna():
    free = _three(fixed_order=False)
    assert STEPS[-1] == "order"
    assert applicable_steps(free) == STEPS
    assert "order" not in applicable_steps(_three())  # con el orden fijo no hay nada que resignar ni que avisar
    assert narrow(free, ["flex", "overnight"]).fixed_order is False
    assert narrow(free, list(STEPS)).fixed_order is True
    assert effective_request(free, {"quota_narrowed": ["order"]}).fixed_order is True


def test_api_cuota_chica_vuelve_al_orden_elegido_y_lo_registra(api, monkeypatch):
    from app.services import serpapi
    from app.settings import get_settings

    monkeypatch.setenv("SERPAPI_API_KEY", "k" * 64)
    get_settings.cache_clear()
    serpapi.METER.left = 200
    trip = {**_three(fixed_order=False).model_dump(mode="json"), "first_checkin_from": "2027-05-10"}

    async def go():
        rid = (await api.post("/v1/runs", json={"trip_request": trip, "mode": "hybrid", "trigger": False,
                                                 "user_id": str(uuid.uuid4())})).json()["run_id"]
        assert (await api.post(f"/v1/runs/{rid}/plan")).status_code == 200
        return (await api.get(f"/v1/runs/{rid}")).json()["summary"]

    try:
        s = asyncio.run(go())
    finally:
        get_settings.cache_clear()
    assert s["quota_narrowed"][-1] == "order"


# ---------------------------------------------------------------- margen mínimo de ida


def test_margen_minimo_en_utc_con_un_dia_de_tolerancia():
    now = datetime(2026, 11, 13, 23, 30, tzinfo=UTC)  # en Buenos Aires son las 20:30 del 13
    assert MIN_LEAD_DAYS == 2
    assert too_soon(date(2026, 11, 13), now)  # hoy
    assert not too_soon(date(2026, 11, 14), now)  # mañana en UTC = pasado mañana para alguien un día atrás
    assert not too_soon(date(2027, 7, 8), now)


def test_api_rechaza_una_ida_inminente_antes_de_gastar_cuota(api):
    today = datetime.now(UTC).date()
    trip = {**BASE, "case_key": None, "first_checkin_from": str(today), "first_checkin_to": str(today)}

    async def go():
        r = await api.post("/v1/runs", json={"trip_request": trip, "trigger": False})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "depart_too_soon"
        ok = {**trip, "first_checkin_from": str(today + timedelta(days=2)), "first_checkin_to": str(today + timedelta(days=2))}
        assert (await api.post("/v1/runs", json={"trip_request": ok, "trigger": False})).status_code == 202

    asyncio.run(go())
