def test_fixture_offer_counts(offers):
    assert len(offers.flights) == 15
    assert len(offers.lodging) == 48  # 12 estadías x 4 propiedades por ciudad
    assert len(offers.activities) == 99  # ORL 8 días x 8 actividades - 1 cierre + NYC 6 días x 6 (3 imperdibles + 3 opcionales)
    assert len(offers.weather) == 14
    assert len(offers.transport) == 2


def test_money_is_integer_minor_units(offers):
    assert all(isinstance(f.price_per_pax_minor, int) for f in offers.flights)
    assert all(isinstance(u.base_total_minor, int) for o in offers.lodging for u in o.units)


def test_epic_closed_date_has_no_offer(offers):
    assert not [a for a in offers.activities if a.activity_key == "EPIC" and a.date.isoformat() == "2027-07-15"]
