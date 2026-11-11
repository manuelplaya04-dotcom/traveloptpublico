"""Superficie pública mínima del motor (auditoría 2026-10-28)."""
import asyncio

from app.settings import get_settings


def test_docs_are_not_public(api):
    async def go():
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert (await api.get(path)).status_code == 404, path
        assert (await api.get("/v1/dev/openapi.json", headers={"Authorization": "Bearer nope"})).status_code == 401
        assert (await api.get("/v1/dev/openapi.json")).json()["info"]["title"] == "TravelOpt Engine"

    asyncio.run(go())


def test_healthz_hides_details_outside_local(api, monkeypatch):
    assert "env" in asyncio.run(api.get("/healthz")).json()
    monkeypatch.setenv("ENV", "production")
    get_settings.cache_clear()
    assert asyncio.run(api.get("/healthz")).json() == {"ok": True}
    assert asyncio.run(api.get("/v1/dev/openapi.json")).status_code == 404
