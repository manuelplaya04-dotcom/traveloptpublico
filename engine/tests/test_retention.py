"""Retención de datos: las búsquedas se borran solas a los `retention_days` días (privacidad sin pedir contacto)."""
import asyncio
from datetime import timedelta

from app.api.main import maintenance
from app.repo.memory import MemoryRepository
from tests.conftest import new_fixture_run


def test_purge_removes_only_old_searches_and_their_data(req):
    repo = MemoryRepository()

    async def go():
        old = await repo.create_run(req, "fixture", None)
        new = await repo.create_run(req, "fixture", None)
        repo.runs[old]["created_at"] -= timedelta(days=31)
        repo.offers[(old, "flights", "F1")] = {"provider": "x", "payload": {}}
        repo.itineraries[old] = [{"rank": 1}]
        purged = await repo.purge_older_than(30)
        return old, new, purged

    old, new, purged = asyncio.run(go())
    assert purged == 1
    assert old not in repo.runs and old not in repo.itineraries
    assert not any(k[0] == old for k in repo.offers)
    assert new in repo.runs  # lo reciente no se toca


def test_maintenance_reaps_and_purges(req, monkeypatch):
    repo = MemoryRepository()

    async def go():
        rid = await repo.create_run(req, "fixture", None)
        repo.runs[rid]["updated_at"] -= timedelta(hours=1)  # colgada
        old = await repo.create_run(req, "fixture", None)
        repo.runs[old]["created_at"] -= timedelta(days=40)  # vencida (no colgada: recién actualizada)
        return await maintenance(repo, 600, 30)

    assert asyncio.run(go()) == {"reaped": 1, "purged": 1}


def test_maintenance_endpoint_reports_both(api):
    async def go():
        await new_fixture_run(api)
        r = await api.post("/v1/maintenance/reap")
        return r.status_code, r.json()

    status, body = asyncio.run(go())
    assert status == 200 and body == {"reaped": 0, "purged": 0}
