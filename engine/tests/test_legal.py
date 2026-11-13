"""Reglas legales por ciudad: desde la base, como restricción dura, con fallo cerrado y explicadas en el embudo."""
import asyncio
import json
import re
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

from app.api.main import current_legal_rules
from app.domain.legal import FAIL_CLOSED, SEED_RULES, LegalRules
from app.domain.models import Constraints
from app.explain.facts import FunnelFacts, legal_facts
from app.explain.integrity import fallback_text, violations
from app.optimizer.filters import lodging_rejection
from app.optimizer.skeletons import Stay
from app.providers.hotels import parse

REAL = json.loads((Path(__file__).parent / "contracts" / "serpapi_google_hotels_nyc.json").read_text("utf-8"))
NYC_4 = Stay("NYC", date(2027, 1, 15), date(2027, 1, 19))
NYC_30 = Stay("NYC", date(2027, 1, 15), date(2027, 1, 15) + timedelta(days=30))
C = Constraints(min_bathrooms=0, min_bedrooms=0)


def test_reglas_y_fallo_cerrado():
    assert not SEED_RULES.rental_allowed("NYC", 29) and SEED_RULES.rental_allowed("NYC", 30)
    assert not SEED_RULES.rental_allowed("LAX", 30) and SEED_RULES.rental_allowed("LAX", 31)
    assert SEED_RULES.rental_allowed("MIA", 2)  # sin regla: libre
    assert not FAIL_CLOSED.rental_allowed("MIA", 365)  # sin poder leer las reglas, ningún alquiler


def test_la_regla_de_nueva_york_deja_solo_hoteles_en_estadias_cortas():
    offers = parse(REAL["hotels"], NYC_4, "p", pax=5)
    kept = [o for o in offers if lodging_rejection(o, NYC_4, C, 5) is None]
    rejected = {lodging_rejection(o, NYC_4, C, 5) for o in offers} - {None}
    assert rejected == {"lodging.short_term_not_legal"}
    assert kept and all(o.units[0].bathrooms_source == "inferred_per_room" for o in kept)  # todo lo que queda es hotel
    assert all(o.short_term_legal for o in parse(REAL["rentals"], NYC_30, "p", pax=5))  # desde 30 noches, legal


def test_las_reglas_salen_de_la_base_no_del_codigo():
    sin_regla = LegalRules(short_term_min_nights={})
    assert all(o.short_term_legal for o in parse(REAL["rentals"], NYC_4, "p", pax=5, legal=sin_regla))
    estricta = LegalRules(short_term_min_nights={"NYC": 60})
    assert not any(o.short_term_legal for o in parse(REAL["rentals"], NYC_30, "p", pax=5, legal=estricta))


def test_fallo_cerrado_bloquea_alquileres_y_deja_hoteles():
    offers = parse(REAL["hotels"], NYC_30, "p", pax=5, legal=FAIL_CLOSED)
    hotels = [o for o in offers if o.units[0].bathrooms_source == "inferred_per_room"]
    rentals = [o for o in offers if o.units[0].bathrooms_source != "inferred_per_room"]
    assert hotels and all(o.short_term_legal for o in hotels)
    assert rentals and not any(o.short_term_legal for o in rentals)


def test_la_norma_viaja_al_explicador_con_su_fuente(req):
    named = req.model_copy(update={"cities": [c.model_copy(update={"name": n}) for c, n in
                                              zip(req.cities, ["Orlando", "Nueva York"])]})
    counts = {"lodging.short_term_not_legal": 4}
    facts = legal_facts(named, counts, SEED_RULES)
    assert [(f.city, f.rule, f.source) for f in facts] == [
        ("Nueva York", "alquiler temporario permitido solo desde 30 noches", "oficial")]
    assert legal_facts(named, {}, SEED_RULES) == []  # sin descartes legales, nada que explicar
    unverified = legal_facts(named, counts, FAIL_CLOSED)
    assert {f.source for f in unverified} == {"no_verificada"} and len(unverified) == 2


def test_el_respaldo_explica_la_norma_y_pasa_el_control(req):
    named = req.model_copy(update={"cities": [c.model_copy(update={"name": n}) for c, n in
                                              zip(req.cities, ["Orlando", "Nueva York"])]})
    facts = FunnelFacts(destinations=["Orlando", "Nueva York"], travelers=5, rejections=[], impossible_date_options=0,
                        date_options=4, relaxations=[],
                        legal_rules=legal_facts(named, {"lodging.short_term_not_legal": 2}, SEED_RULES))
    text = fallback_text(facts)
    assert ("En Nueva York descartamos alquileres temporarios por la norma local: alquiler temporario permitido solo "
            "desde 30 noches.") in text
    assert violations(text, facts) == []


def test_las_reglas_se_cachean_y_el_fallo_cerrado_no():
    class Repo:
        def __init__(self, rules):
            self.rules, self.calls = rules, 0

        async def legal_rules(self):
            self.calls += 1
            return self.rules

    async def go(rules):
        app, repo = SimpleNamespace(state=SimpleNamespace()), Repo(rules)
        await current_legal_rules(app, repo)
        await current_legal_rules(app, repo)
        return repo.calls

    assert asyncio.run(go(SEED_RULES)) == 1
    assert asyncio.run(go(FAIL_CLOSED)) == 2  # sin cachear: el próximo pedido vuelve a intentar leer la base


def test_paris_exige_registro_y_ninguna_estadia_lo_salva(req):
    assert not SEED_RULES.rental_allowed("PAR", 1) and not SEED_RULES.rental_allowed("PAR", 365)
    assert SEED_RULES.rental_allowed("LON", 2)  # Londres: el tope anual es del anfitrión, no de la estadía
    paris = req.model_copy(update={"cities": [req.cities[0].model_copy(update={"code": "PAR", "name": "París"})]})
    facts = legal_facts(paris, {"lodging.short_term_not_legal": 3}, SEED_RULES)
    assert [(f.city, f.source) for f in facts] == [("París", "oficial")]
    assert "número de registro" in facts[0].rule and not any(ch.isdigit() for ch in facts[0].rule)


def test_el_respaldo_del_codigo_coincide_con_las_migraciones():
    """SEED_RULES rige sin base (tests, modo local): tiene que decir lo mismo que lo que siembran las migraciones."""
    rows: dict[tuple[str, str], tuple[int, str]] = {}
    for path in sorted((Path(__file__).parents[2] / "supabase" / "migrations").glob("*.sql")):
        for city, rule, value, kind in re.findall(
                r"\('([A-Z]{3})', '(short_term_rental_[a-z_]+)', (\d+),\s*'(?:[^']|'')*',\s*'https://[^']+',\s*'(official|secondary)'",
                path.read_text("utf-8")):
            rows[(city, rule)] = (int(value), kind)  # una migración posterior corrige a la anterior
    assert rows, "la expresión dejó de encontrar las reglas sembradas"
    min_nights = {c: v for (c, r), (v, _) in rows.items() if r == "short_term_rental_min_nights"}
    registration = {c for (c, r) in rows if r == "short_term_rental_registration_required"}
    assert min_nights == SEED_RULES.short_term_min_nights
    assert registration == SEED_RULES.registration_required
    assert {c: k for (c, _), (_, k) in rows.items()} == SEED_RULES.sources
