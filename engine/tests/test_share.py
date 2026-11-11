"""Links de solo lectura: solo el dueño de una corrida terminada los crea; la vista no expone datos de quien comparte."""
import asyncio

from app.providers.fixture import FixtureProvider

OWNER = "00000000-0000-4000-8000-0000000000aa"
OTHER = "00000000-0000-4000-8000-0000000000bb"


def _done_run(status="done") -> str:
    from app.api.main import app

    async def go():
        repo = app.state.repo
        rid = await repo.create_run(FixtureProvider("orlando_nyc_5pax").trip_request(), "fixture", OWNER)
        await repo.transition(rid, {"queued"}, status)
        await repo.save_itineraries(rid, OWNER, [{"rank": 1, "skeleton_id": "s", "total_minor": 100, "currency": "USD",
                                                  "within_budget": True, "stays": []}])
        return rid

    return asyncio.run(go())


def test_el_duenio_comparte_y_cualquiera_con_el_link_ve_solo_lectura(api):
    rid = _done_run()

    async def go():
        a = await api.post(f"/v1/runs/{rid}/share", json={"uid": OWNER})
        b = await api.post(f"/v1/runs/{rid}/share", json={"uid": OWNER})  # volver a compartir: mismo link
        view = await api.get(f"/v1/shares/{a.json()['token']}")
        return a, b, view

    a, b, view = asyncio.run(go())
    assert a.status_code == 200 and a.json()["token"] == b.json()["token"]
    body = view.json()
    assert view.status_code == 200 and body["status"] == "done" and len(body["itineraries"]) == 1
    assert "budget_minor" not in body["request"] and OWNER not in str(body)  # sin presupuesto ni ids de usuario


def test_bola_otra_persona_no_puede_compartir_una_corrida_ajena(api):
    rid = _done_run()

    async def go():
        return await api.post(f"/v1/runs/{rid}/share", json={"uid": OTHER})

    r = asyncio.run(go())
    assert r.status_code == 404  # como si no existiera: no confirma que la corrida exista


def test_no_se_comparte_una_corrida_sin_terminar_ni_un_token_inventado(api):
    rid = _done_run(status="extracting")

    async def go():
        return (await api.post(f"/v1/runs/{rid}/share", json={"uid": OWNER}),
                await api.get("/v1/shares/00000000-0000-4000-8000-000000000000"),
                await api.get("/v1/shares/no-es-un-uuid"))

    pending, unknown, bad = asyncio.run(go())
    assert pending.status_code == 409 and unknown.status_code == 404 and bad.status_code == 422
