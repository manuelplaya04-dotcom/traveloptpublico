from app.optimizer.skeletons import generate_skeletons


def test_skeleton_enumeration(req):
    ids = [s.id for s in generate_skeletons(req)]
    assert len(ids) == 6  # 2 fechas de check-in x 3 repartos de noches (6-6, 7-5, 8-4)
    assert "ORL-NYC|2027-07-08|8-4" in ids


def test_minimal_query_plan(plan):
    assert len(plan.flights) == 9  # 3 (ida, incl. nocturnos) + 4 (ORL->NYC) + 2 (regreso)
    assert len(plan.stays) == 12  # 6 estadías ORL + 6 NYC, sin duplicados
    assert len(plan.city_days) == 14  # 8 días útiles ORL + 6 NYC


def test_overnight_outbound_allowed(req):
    first_leg = generate_skeletons(req)[0].legs[0]
    assert [d.isoformat() for d in first_leg.depart_dates] == ["2027-07-07", "2027-07-08"]
    assert first_leg.arrive_on.isoformat() == "2027-07-08"
