"""4b.3: alternativas de alojamiento por estadía para el dashboard por ciudad."""
from app.optimizer.finance import build_breakdown
from app.optimizer.service import itinerary_to_dict
from app.optimizer.solver import optimize


def test_first_eligible_option_is_the_optimal_choice(req, offers):
    best = optimize(req, offers, engine="cpsat").itineraries[0]
    row = itinerary_to_dict(best, build_breakdown(best, req), req.pax, (req, offers))
    assert row["total_minor"] == 2008362  # agregar alternativas no mueve el golden
    for sp, st in zip(best.stays, row["stays"]):
        opts = st["lodging_options"]
        eligible = [o for o in opts if o["rejection"] is None]
        assert eligible[0]["offer_id"] == sp.lodging.offer.id
        assert eligible[0]["cost_minor"] == sp.lodging.cost_minor == st["lodging"]["cost_minor"]
        assert [o["cost_minor"] for o in eligible] == sorted(o["cost_minor"] for o in eligible)
        assert all(o["rejection"] for o in opts[len(eligible):])  # descartadas al final, con motivo


def test_rejections_match_the_funnel(req, offers):
    res = optimize(req, offers, engine="cpsat")
    best = res.itineraries[0]
    row = itinerary_to_dict(best, build_breakdown(best, req), req.pax, (req, offers))
    nyc = row["stays"][1]["lodging_options"]
    illegal = {o["offer_id"] for o in nyc if o["rejection"] == "lodging.short_term_not_legal"}
    assert illegal and illegal <= set(res.diagnostics["rejections"]["lodging.short_term_not_legal"])


def test_without_alternatives_payload_is_unchanged(req, offers):
    best = optimize(req, offers, engine="cpsat").itineraries[0]
    row = itinerary_to_dict(best, build_breakdown(best, req), req.pax)
    assert all("lodging_options" not in st for st in row["stays"])
