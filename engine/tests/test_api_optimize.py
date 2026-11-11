"""Fase 3: flujo completo por HTTP hasta 'done', verificado contra el golden."""
import asyncio
import json
from pathlib import Path

from tests.conftest import CASE, new_fixture_run

GOLDEN = json.loads((Path(__file__).parents[1] / "fixtures" / CASE / "expected.json").read_text(encoding="utf-8"))
KINDS = ["flights", "lodging", "activities", "weather", "transport"]


def test_full_flow_reaches_done_with_golden_total(api):
    async def go():
        rid = await new_fixture_run(api)
        await api.post(f"/v1/runs/{rid}/plan")
        await asyncio.gather(*(api.post(f"/v1/runs/{rid}/extract/{k}") for k in KINDS))
        opt = await api.post(f"/v1/runs/{rid}/optimize")
        assert opt.status_code == 200, opt.text
        run = (await api.get(f"/v1/runs/{rid}")).json()
        assert run["status"] == "done"
        assert set(run["timings"]) == {"queued", "extracting", "optimizing", "done"}
        its = run["itineraries"]
        assert [i["total_minor"] for i in its] == GOLDEN["top_totals_minor"]
        assert its[0]["skeleton_id"] == GOLDEN["best_skeleton_id"]
        assert sum(ln["total_minor"] for ln in its[0]["breakdown"]["lines"]) == GOLDEN["best_total_minor"]

    asyncio.run(go())


def test_optimize_twice_is_rejected(api):
    async def go():
        rid = await new_fixture_run(api)
        assert (await api.post(f"/v1/runs/{rid}/run-all")).status_code == 200
        assert (await api.post(f"/v1/runs/{rid}/optimize")).status_code == 409

    asyncio.run(go())
