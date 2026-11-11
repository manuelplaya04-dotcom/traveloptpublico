"""CP-4.13: límite de corridas por user_id en POST /v1/runs (hallazgo A4 de la auditoría)."""
import asyncio
import json
import uuid
from datetime import timedelta
from pathlib import Path

from app.api.main import app
from app.settings import get_settings

TRIP = json.loads((Path(__file__).parents[1] / "fixtures/orlando_nyc_5pax/trip_request.json").read_text("utf-8"))


async def _post(api, user_id):
    return await api.post("/v1/runs", json={"trip_request": TRIP, "user_id": user_id, "trigger": False})


def test_two_active_runs_block_the_third(api):
    async def go():
        uid = str(uuid.uuid4())
        assert [(await _post(api, uid)).status_code for _ in range(2)] == [202, 202]
        r = await _post(api, uid)
        assert r.status_code == 429 and r.headers["retry-after"] == "60"
        assert r.json()["detail"] == {"code": "rate_limited", "scope": "user", "active": 2, "last_hour": 2}
        assert (await _post(api, str(uuid.uuid4()))).status_code == 202  # otro usuario no se ve afectado

    asyncio.run(go())


def test_hourly_cap_counts_finished_runs(api):
    async def go():
        uid, repo = str(uuid.uuid4()), app.state.repo
        for _ in range(10):
            rid = (await _post(api, uid)).json()["run_id"]
            await repo.transition(rid, {"queued"}, "done")
        assert (await _post(api, uid)).status_code == 429
        for r in repo.runs.values():  # una hora después, el cupo se libera
            r["created_at"] -= timedelta(hours=1, seconds=1)
        assert (await _post(api, uid)).status_code == 202

    asyncio.run(go())


def test_runs_without_user_are_not_limited(api):
    async def go():
        assert [(await _post(api, None)).status_code for _ in range(3)] == [202] * 3

    asyncio.run(go())


def test_global_cap_across_anonymous_users(api, monkeypatch):
    monkeypatch.setenv("MAX_ACTIVE_RUNS_TOTAL", "3")
    get_settings.cache_clear()

    async def go():
        assert [(await _post(api, str(uuid.uuid4()))).status_code for _ in range(3)] == [202] * 3
        r = await _post(api, str(uuid.uuid4()))  # usuario nuevo, pero el sistema ya está lleno
        assert r.status_code == 429 and r.json()["detail"] == {"code": "rate_limited", "scope": "global", "total_active": 3}

    asyncio.run(go())


KEY_A, KEY_B = "a" * 32, "b" * 32  # claves seudónimas de prueba (formato: 32 hex)


def test_cap_per_connection_across_new_sessions(api, monkeypatch):
    """Sesiones anónimas nuevas desde la misma conexión (misma clave seudónima de IP) comparten el cupo por hora."""
    monkeypatch.setenv("MAX_RUNS_PER_CLIENT_HOUR", "3")
    get_settings.cache_clear()

    async def go():
        repo = app.state.repo

        async def post(key, uid=None):
            r = await api.post("/v1/runs", json={"trip_request": TRIP, "user_id": uid or str(uuid.uuid4()), "trigger": False},
                               headers={"X-Client-Key": key})
            if r.status_code == 202:
                await repo.transition(r.json()["run_id"], {"queued"}, "done")
            return r

        assert [(await post(KEY_A)).status_code for _ in range(3)] == [202] * 3
        r = await post(KEY_A)
        assert r.status_code == 429 and r.headers["retry-after"] == "60"
        assert r.json()["detail"] == {"code": "rate_limited", "scope": "client", "last_hour": 3}
        assert (await post(KEY_B)).status_code == 202  # otra conexión no se ve afectada
        for run in repo.runs.values():
            run["created_at"] -= timedelta(hours=1, seconds=1)
        assert (await post(KEY_A)).status_code == 202  # una hora después se libera

    asyncio.run(go())


def test_client_key_with_wrong_format_is_ignored_not_trusted(api, monkeypatch):
    """Una IP en claro o basura en el header no se guarda ni se usa como clave."""
    monkeypatch.setenv("MAX_RUNS_PER_CLIENT_HOUR", "1")
    get_settings.cache_clear()

    async def go():
        for bad in ("192.168.0.1", "x" * 32, "", KEY_A.upper()):
            r = await api.post("/v1/runs", json={"trip_request": TRIP, "user_id": str(uuid.uuid4()), "trigger": False},
                               headers={"X-Client-Key": bad})
            assert r.status_code == 202
            assert app.state.repo.runs[r.json()["run_id"]]["client_key"] is None

    asyncio.run(go())
