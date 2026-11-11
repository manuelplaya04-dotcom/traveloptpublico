"""Checkpoint del caso hardcodeado Orlando + NYC (5 pax). Valores calculados a mano y por oráculo."""
from app.optimizer.finance import build_breakdown
from app.optimizer.solver import optimize


def test_optimum(req, offers):
    res = optimize(req, offers, engine="cpsat")
    best = res.itineraries[0]
    assert res.status == "ok"
    assert best.skeleton.id == "ORL-NYC|2027-07-08|8-4"
    assert best.total_minor == 2008362  # USD 20,083.62
    assert [it.total_minor for it in res.itineraries] == [2008362, 2042378, 2110878]
    assert [f.offer.id for f in best.flights] == ["F02", "F13", "F21"]
    orl, nyc = best.stays
    assert orl.lodging.offer.id.startswith("H2@")
    assert nyc.lodging.offer.id.startswith("N2@")
    assert nyc.lodging.units == ((0, 1), (1, 1))  # 1x "2 Queen" + 1x "Queen" = 6 plazas, 2 baños
    assert orl.activities.cost_minor == 455000
    assert nyc.activities.cost_minor == 53000
    assert res.stats["skeletons_total"] == 6
    assert res.stats["skeletons_feasible"] == 4
    assert res.stats["all_subproblems_optimal"] is True


def test_feasibility_funnel(req, offers):
    d = optimize(req, offers).diagnostics
    r = d["rejections"]
    assert r["flight.too_many_stops"] == ["F04"]
    assert r["flight.insufficient_seats"] == ["F05"]
    assert r["flight.departs_too_early"] == ["F14"]
    assert all(i.startswith("H3@") for i in r["lodging.bathrooms"])
    assert all(i.startswith("N3@") for i in r["lodging.short_term_not_legal"])
    assert all(i.startswith("H2@") for i in r["lodging.min_nights"])
    assert set(d["infeasible_skeletons"]) == {"ORL-NYC|2027-07-08|6-6", "ORL-NYC|2027-07-09|6-6"}
    assert set(d["infeasible_skeletons"].values()) == {"actividades_infactibles:ORL"}


def test_breakdown_reconciles(req, offers):
    best = optimize(req, offers).itineraries[0]
    b = build_breakdown(best, req)
    assert b.total_minor == best.total_minor
    assert b.by_category == {
        "vuelos": 1048500,
        "alojamiento": 355662,
        "actividades": 508000,
        "transporte": 96200,
    }
    assert b.per_pax_minor == [401673, 401673, 401672, 401672, 401672]
    assert sum(b.per_pax_minor) == b.total_minor


def test_weather_is_hard_constraint(req, offers):
    best = optimize(req, offers).itineraries[0]
    for sp in best.stays:
        for a in sp.activities.items:
            assert not (a.city == "ORL" and a.date.isoformat() == "2027-07-12")
            assert not (a.outdoor and a.city == "NYC" and a.date.isoformat() == "2027-07-18")


def test_exigir_cocina_sin_dato_no_se_relaja_en_silencio(req, offers):
    """El fixture no informa cocina: exigirla deja sin alojamiento con motivo en el embudo (no se supone que la
    tengan) y el optimizador no inventa un itinerario. Con cocina informada en las opciones del óptimo, el óptimo
    vuelve a ser el golden."""
    strict = req.model_copy(update={"constraints": req.constraints.model_copy(update={"require_kitchen": True})})
    res = optimize(strict, offers, engine="cpsat")
    assert res.itineraries == []
    assert res.diagnostics["rejections"]["lodging.kitchen_unknown"]
    with_kitchen = offers.model_copy(update={"lodging": [o.model_copy(update={"kitchen": True}) for o in offers.lodging]})
    assert optimize(strict, with_kitchen, engine="cpsat").itineraries[0].total_minor == 2008362
