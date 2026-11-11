"""Contrato HTTP que consume n8n (Fase 1): crear -> plan -> extract x5. Optimize llega en Fase 3."""
import asyncio
import time

from tests.conftest import new_fixture_run

KINDS = ["flights", "lodging", "activities", "weather", "transport"]


def test_requires_api_key(api):
    async def go():
        r = await api.post("/v1/dev/runs/orlando_nyc_5pax", headers={"Authorization": "Bearer nope"})
        assert r.status_code == 401

    asyncio.run(go())


def test_plan_and_parallel_extract(api):
    async def go():
        rid = await new_fixture_run(api)
        plan = (await api.post(f"/v1/runs/{rid}/plan")).json()
        assert [t["kind"] for t in plan["tasks"]] == KINDS
        results = await asyncio.gather(*(api.post(f"/v1/runs/{rid}/extract/{k}") for k in KINDS))
        assert all(r.status_code == 200 for r in results), [r.text for r in results]
        assert {r.json()["kind"]: r.json()["offers"] for r in results} == {
            "flights": 15, "lodging": 48, "activities": 99, "weather": 14, "transport": 2,
        }
        run = (await api.get(f"/v1/runs/{rid}")).json()
        assert run["status"] == "extracting" and run["summary"]["query_plan"]["flights"] == 9

    asyncio.run(go())


def test_state_machine_is_enforced(api):
    async def go():
        rid = await new_fixture_run(api)
        assert (await api.post(f"/v1/runs/{rid}/extract/flights")).status_code == 409  # antes de plan
        assert (await api.post(f"/v1/runs/{rid}/plan")).status_code == 200
        assert (await api.post(f"/v1/runs/{rid}/plan")).status_code == 409  # webhook duplicado
        await api.post(f"/v1/runs/{rid}/fail", json={"code": "test"})
        assert (await api.get(f"/v1/runs/{rid}")).json()["status"] == "failed"

    asyncio.run(go())


def test_extract_is_idempotent(api):
    async def go():
        rid = await new_fixture_run(api)
        await api.post(f"/v1/runs/{rid}/plan")
        a = (await api.post(f"/v1/runs/{rid}/extract/flights")).json()["offers"]
        b = (await api.post(f"/v1/runs/{rid}/extract/flights")).json()["offers"]  # reintento de n8n
        assert a == b == 15

    asyncio.run(go())


def test_parallel_extraction_takes_max_not_sum(api):
    async def go():
        rid = await new_fixture_run(api)
        await api.post(f"/v1/runs/{rid}/plan")
        t0 = time.perf_counter()
        await asyncio.gather(*(api.post(f"/v1/runs/{rid}/extract/{k}", params={"delay_ms": 500}) for k in KINDS))
        assert time.perf_counter() - t0 < 1.5  # en serie serían 2,5 s

    asyncio.run(go())


def test_optimize_returns_501_until_phase_3(api, monkeypatch):
    import app.api.main as main

    monkeypatch.setattr(main, "run_optimization", None)

    async def go():
        rid = await new_fixture_run(api)
        await api.post(f"/v1/runs/{rid}/plan")
        r = await api.post(f"/v1/runs/{rid}/optimize")
        assert r.status_code == 501 and r.json()["detail"]["code"] == "optimizer_not_ready"

    asyncio.run(go())


# ---------------------------------------------------------------- endurecimiento de seguridad


def test_dev_routes_are_closed_in_production(api, monkeypatch):
    """Falla cerrado: con ENV=production las rutas de depuración no existen (404)."""
    from app.settings import get_settings

    monkeypatch.setenv("ENV", "production")
    get_settings.cache_clear()

    async def go():
        try:
            r = await api.post("/v1/dev/runs/orlando_nyc_5pax")
            assert r.status_code == 404
            r = await api.post("/v1/runs/6f1c1a52-0b1e-4c63-9a3d-0f8a5a7d2b11/run-all")
            assert r.status_code == 404
        finally:
            get_settings.cache_clear()

    asyncio.run(go())


def test_env_defaults_to_production(monkeypatch):
    from app.settings import Settings

    monkeypatch.delenv("ENV", raising=False)
    assert Settings(_env_file=None, engine_api_key="x" * 24).env == "production"


def test_invalid_case_key_is_rejected_in_create_run(api):
    async def go():
        r = await api.post("/v1/runs", json={"trip_request": {**_fixture_request(), "case_key": "../x"}, "trigger": False})
        assert r.status_code == 422

    asyncio.run(go())


def test_path_traversal_in_dev_route_is_rejected(api):
    async def go():
        assert (await api.post("/v1/dev/runs/..%2Fx")).status_code in (404, 422)
        assert (await api.post("/v1/dev/runs/..")).status_code in (404, 422)
        assert (await api.post("/v1/dev/runs/" + "a" * 65)).status_code == 422
        assert (await api.post("/v1/dev/runs/inexistente")).status_code == 404  # bien formado, sin carpeta

    asyncio.run(go())


def test_fixture_provider_rejects_bad_case_key():
    import pytest

    from app.providers.fixture import FixtureProvider

    for bad in ("../x", "..", "a/b", "A", "", "x" * 65, "orlando_nyc_5pax/../orlando_nyc_5pax"):
        with pytest.raises(ValueError, match="case_key inválido"):
            FixtureProvider(bad)


def test_non_ascii_authorization_header_is_401_not_500(api):
    async def go():
        r = await api.post("/v1/dev/runs/orlando_nyc_5pax", headers={"Authorization": "Bearer ñandú".encode("latin-1")})
        assert r.status_code == 401

    asyncio.run(go())


def test_oversized_body_is_413(api):
    async def go():
        r = await api.post("/v1/runs/6f1c1a52-0b1e-4c63-9a3d-0f8a5a7d2b11/fail", content=b'{"code":"' + b"x" * 70_000 + b'"}',
                           headers={"Content-Type": "application/json"})
        assert r.status_code == 413

    asyncio.run(go())


def test_oversized_chunked_body_is_413(api):
    async def chunks():  # sin Content-Length: el límite debe aplicarse sobre los bytes recibidos
        for _ in range(8):
            yield b"x" * 10_000

    async def go():
        r = await api.post("/v1/runs/6f1c1a52-0b1e-4c63-9a3d-0f8a5a7d2b11/fail", content=chunks(),
                           headers={"Content-Type": "application/json"})
        assert r.status_code == 413
        assert r.json()["detail"]["code"] == "payload_too_large"

    asyncio.run(go())


def test_fail_in_field_lengths_are_bounded(api):
    async def go():
        rid = await new_fixture_run(api)
        assert (await api.post(f"/v1/runs/{rid}/fail", json={"code": "x" * 65})).status_code == 422
        assert (await api.post(f"/v1/runs/{rid}/fail", json={"code": "ok", "message": "x" * 501})).status_code == 422
        assert (await api.post(f"/v1/runs/{rid}/fail", json={"code": "ok", "node": "x" * 65})).status_code == 422
        assert (await api.post(f"/v1/runs/{rid}/fail", json={"code": "ok", "message": "x" * 500})).status_code == 200

    asyncio.run(go())


def test_fail_does_not_expose_internal_message(api):
    """El usuario lee `search_runs.error` por RLS: solo código y nodo, nunca el detalle interno."""
    async def go():
        rid = await new_fixture_run(api)
        body = {"code": "workflow_error", "node": "Extract", "message": '{"upstream":"respuesta interna"}'}
        assert (await api.post(f"/v1/runs/{rid}/fail", json=body)).status_code == 200
        return (await api.get(f"/v1/runs/{rid}")).json()

    run = asyncio.run(go())
    assert run["status"] == "failed" and run["error"] == {"code": "workflow_error", "node": "Extract"}


def test_create_run_rejects_unknown_fields(api):
    async def go():
        r = await api.post("/v1/runs", json={"trip_request": _fixture_request(), "trigger": False, "is_admin": True})
        assert r.status_code == 422
        assert (await api.post("/v1/runs/6f1c1a52-0b1e-4c63-9a3d-0f8a5a7d2b11/extract/flights",
                               params={"delay_ms": -1})).status_code == 422

    asyncio.run(go())


def _fixture_request() -> dict:
    from app.providers.fixture import FixtureProvider

    return FixtureProvider("orlando_nyc_5pax").trip_request().model_dump(mode="json")
