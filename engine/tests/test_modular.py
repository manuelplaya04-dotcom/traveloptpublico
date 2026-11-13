"""Optimización modular: vuelos, alojamiento y actividades se cotizan solo si la persona los pide.

Un módulo apagado no genera consultas (ningún proveedor se llama), no entra al modelo ni suma al total, y el
explicador no puede nombrarlo. Con los tres encendidos (el default) todo sigue igual: el golden no se mueve.
"""
import asyncio
import uuid

import pytest
from pydantic import ValidationError

from app.domain.models import NO_SERVICE_SELECTED, Services, TripRequest
from app.explain.facts import build_facts, quoted_modules, relaxed_requests
from app.explain.integrity import fallback_text, violations
from app.optimizer.finance import build_breakdown
from app.optimizer.service import itinerary_to_dict
from app.optimizer.skeletons import build_query_plan, generate_skeletons
from app.optimizer.solver import optimize
from app.providers.base import fetch
from app.providers.registry import extract
from tests.conftest import CASE

GOLDEN_TOTAL = 2008362


def with_services(req: TripRequest, **on: bool) -> TripRequest:
    return req.model_copy(update={"services": Services(**on)})


# ---------------------------------------------------------------- contrato


def test_sin_ningun_servicio_es_un_error_claro():
    with pytest.raises(ValidationError, match=NO_SERVICE_SELECTED):
        Services(flights=False, lodging=False, activities=False)


@pytest.mark.parametrize("bad", [{"flights": "false"}, {"flights": 0}, {"lodging": None}, {"cars": True}])
def test_servicios_estrictos_sin_coercion_ni_campos_de_mas(bad):
    with pytest.raises(ValidationError):
        Services.model_validate(bad)


def test_origen_obligatorio_solo_si_se_cotizan_vuelos(req):
    data = {**req.model_dump(mode="json"), "origin_airports": []}
    with pytest.raises(ValidationError, match="origin_airports"):
        TripRequest.model_validate(data)
    ok = TripRequest.model_validate({**data, "services": {"flights": False}})
    assert ok.services == Services(flights=False, lodging=True, activities=True)


def test_por_defecto_se_cotiza_todo_y_el_golden_no_cambia(req, offers):
    assert req.services == Services()
    explicit = with_services(req, flights=True, lodging=True, activities=True)
    assert optimize(explicit, offers).itineraries[0].total_minor == GOLDEN_TOTAL


# ---------------------------------------------------------------- plan de consultas


def test_un_modulo_apagado_no_genera_consultas(req):
    def plan(**on):
        r = with_services(req, **on)
        return build_query_plan(r, generate_skeletons(r))

    full = plan()
    assert full.flights and full.stays and full.city_days
    assert not plan(flights=False).flights and plan(flights=False).stays == full.stays
    assert not plan(lodging=False).stays and plan(lodging=False).flights == full.flights
    assert not plan(activities=False).city_days  # el clima solo filtra actividades: va con ellas
    assert plan(activities=False).cities == full.cities  # la movilidad local se sigue cotizando


def test_sin_consultas_no_se_llama_al_proveedor(req):
    class Boom:
        async def flights(self, queries):
            raise AssertionError("no debía llamarse")

    r = with_services(req, flights=False)
    plan = build_query_plan(r, generate_skeletons(r))
    assert asyncio.run(fetch(Boom(), "flights", plan)) == []
    assert asyncio.run(extract({}, "flights", plan)) == []  # sin proveedor configurado tampoco es un error


# ---------------------------------------------------------------- optimizador


@pytest.mark.parametrize("on", [{"flights": False}, {"lodging": False}, {"activities": False},
                                {"flights": False, "lodging": False}, {"lodging": False, "activities": False}])
def test_cpsat_y_fuerza_bruta_coinciden_en_cada_combinacion(req, offers, on):
    r = with_services(req, **on)
    cpsat, brute = optimize(r, offers, "cpsat"), optimize(r, offers, "brute")
    assert [it.total_minor for it in cpsat.itineraries] == [it.total_minor for it in brute.itineraries]
    for it in cpsat.itineraries:
        b = build_breakdown(it, r)  # concilia al centavo o falla
        assert b.total_minor == it.total_minor


def test_sin_vuelos_el_viaje_arranca_en_el_destino(req, offers):
    r = with_services(req, flights=False)
    res = optimize(r, offers)
    assert res.status == "ok"
    for it in res.itineraries:
        assert it.flights == []
        assert all(sp.transport is None or sp.transport.mode != "transfers" for sp in it.stays)
        assert "vuelos" not in build_breakdown(it, r).by_category
    assert not any(why.startswith("sin_vuelo") for why in res.diagnostics["infeasible_skeletons"].values())
    assert not any(k.startswith("flight.") for k in res.diagnostics["rejections"])
    # sin vuelos ni traslados al aeropuerto, el óptimo no puede costar más que el golden menos esos dos rubros
    assert res.itineraries[0].total_minor <= GOLDEN_TOTAL - 1048500 - 19000


def test_sin_alojamiento_la_estadia_queda_sin_elegir_y_sin_costo(req, offers):
    r = with_services(req, lodging=False)
    res = optimize(r, offers)
    best = res.itineraries[0]
    assert all(sp.lodging is None for sp in best.stays)
    assert "alojamiento" not in build_breakdown(best, r).by_category
    assert not any(k.startswith("lodging.") for k in res.diagnostics["rejections"])
    payload = itinerary_to_dict(best, build_breakdown(best, r), r.pax, (r, offers))
    assert all(st["lodging"] is None and "lodging_options" not in st for st in payload["stays"])


def test_sin_actividades_no_hay_imperdibles_que_vuelvan_imposible_una_fecha(req, offers):
    r = with_services(req, activities=False)
    res = optimize(r, offers)
    assert all(not sp.activities.items for it in res.itineraries for sp in it.stays)
    assert not any(w.startswith("actividades") for w in res.diagnostics["infeasible_skeletons"].values())
    assert "actividades_no_disponibles" not in res.diagnostics["warnings"]  # no pedirlas no es una falla


# ---------------------------------------------------------------- explicador


def test_el_explicador_solo_habla_de_lo_cotizado(req, offers):
    r = with_services(req, flights=False)
    assert quoted_modules(r) == ["alojamiento", "actividades"]
    counts = {"flight.too_many_stops": 9, "lodging.bathrooms": 3}  # diagnóstico viejo o ajeno: igual se filtra
    assert [lever.field for lever, *_ in relaxed_requests(r, counts)] == ["min_bathrooms"]
    facts = build_facts(r, {"diagnostics": {}, "stats": {"skeletons_total": 6}}, [])
    assert facts.quoted == ["alojamiento", "actividades"]
    assert violations("No hay vuelos posibles para Orlando y Nueva York.", facts)[-1].endswith("vuelos")
    assert violations("Ningún alojamiento cumple tus condiciones en Orlando y Nueva York.", facts) == []
    text = fallback_text(facts)
    assert text.startswith("No encontramos") and "Cotizamos solo alojamiento y actividades" in text
    assert violations(text, facts) == []


def test_con_todo_cotizado_el_respaldo_no_cambia(req):
    facts = build_facts(req, {"diagnostics": {}, "stats": {"skeletons_total": 6}}, [])
    assert facts.quoted == ["vuelos", "alojamiento", "actividades"]
    assert "Cotizamos solo" not in fallback_text(facts)


# ---------------------------------------------------------------- API


def _trip(**services) -> dict:
    from app.providers.fixture import FixtureProvider

    return {**FixtureProvider(CASE).trip_request().model_dump(mode="json"), "services": services}


def test_api_sin_servicios_responde_422_con_el_motivo(api):
    async def go():
        r = await api.post("/v1/runs", json={"trip_request": _trip(flights=False, lodging=False, activities=False),
                                              "trigger": False})
        assert r.status_code == 422
        assert NO_SERVICE_SELECTED in r.text
        r = await api.post("/v1/runs", json={"trip_request": _trip(flights="no"), "trigger": False})
        assert r.status_code == 422

    asyncio.run(go())


def test_api_flujo_completo_sin_vuelos(api):
    async def go():
        uid = str(uuid.uuid4())
        trip = {**_trip(flights=False), "origin_airports": []}
        rid = (await api.post("/v1/runs", json={"trip_request": trip, "user_id": uid, "trigger": False})).json()["run_id"]
        assert (await api.post(f"/v1/runs/{rid}/run-all")).json()["status"] == "done"
        run = (await api.get(f"/v1/runs/{rid}")).json()
        assert run["summary"]["query_plan"]["flights"] == 0  # ninguna búsqueda de vuelos
        best = run["itineraries"][0]
        assert best["flights"] == [] and "vuelos" not in best["breakdown"]["by_category"]

    asyncio.run(go())
