"""Explicador del embudo: hechos del motor, control anti-alucinación, adaptador de Gemini (sin red) y servicio."""
import asyncio
import json
import uuid
from pathlib import Path

import httpx
import pytest

from app.explain.facts import FunnelFacts, Relaxation, RejectionFact, build_facts, rejection_counts
from app.explain.gemini import ENDPOINT, ExplanationUnavailable, GeminiExplainer, extract_text, request_body
from app.explain.integrity import MAX_CHARS, fallback_text, violations
from app.explain.service import compute_facts, explain
from app.optimizer.solver import optimize
from app.services.cache import MemoryCache
from app.services.http import BREAKERS

KEY = "test-gemini-key-no-real"
TRIP = json.loads((Path(__file__).parents[1] / "fixtures/orlando_nyc_5pax/trip_request.json").read_text("utf-8"))


@pytest.fixture(autouse=True)
def _fresh_breaker():
    BREAKERS.clear()
    yield
    BREAKERS.clear()


def strict(req, **update):
    return req.model_copy(update={"constraints": req.constraints.model_copy(update=update)})


def summary_of(res) -> dict:
    return {"diagnostics": res.diagnostics, "stats": res.stats}


FACTS = FunnelFacts(
    destinations=["Orlando", "Nueva York"], travelers=5,
    rejections=[RejectionFact(what="vuelos con más escalas que tu máximo", count=7),
                RejectionFact(what="vuelos que llegan después de tu hora máxima", count=2)],
    impossible_date_options=6, date_options=6,
    relaxations=[Relaxation(setting="escalas máximas por tramo", current="0", proposed="1", feasible=True,
                            best_total="USD 20,083.62")],
)
GOOD = ("No encontramos un viaje sin escalas: 7 vuelos tenían más escalas que tu máximo. "
        "Si aceptás 1 escala por tramo, el mejor itinerario cuesta USD 20,083.62.")


# ---------------------------------------------------------------- hechos

def test_hechos_del_golden_sin_escalas_con_el_contrafactual_calculado_por_el_optimizador(req, offers):
    """Sin escalas no hay viaje; aflojando a 1 escala, el optimizador recupera exactamente el óptimo golden."""
    tight = strict(req, max_stops=0)
    res = optimize(tight, offers, "cpsat")
    assert res.itineraries == []
    facts = asyncio.run(compute_facts(tight, summary_of(res), offers, asyncio.Semaphore(1)))
    assert facts.rejections[0].what == "vuelos con más escalas que tu máximo"
    first = facts.relaxations[0]
    assert (first.setting, first.current, first.proposed, first.feasible, first.best_total) == (
        "escalas máximas por tramo", "0", "1", True, "USD 20,083.62")
    assert facts.impossible_date_options == facts.date_options > 0
    # determinístico: misma entrada, mismos hechos
    assert asyncio.run(compute_facts(tight, summary_of(res), offers, asyncio.Semaphore(1))) == facts


def test_los_hechos_no_llevan_datos_de_la_persona(req, offers):
    res = optimize(strict(req, max_stops=0), offers, "cpsat")
    payload = asyncio.run(compute_facts(strict(req, max_stops=0), summary_of(res), offers, asyncio.Semaphore(1)))
    text = payload.model_dump_json()
    for leak in (str(req.budget_minor), req.origin_airports[0], "2027-07", "user", "@"):
        assert leak not in text


@pytest.mark.parametrize("diagnostics", [None, {}, "basura", {"rejections": "x"}, {"rejections": {"a": "no-lista"}},
                                         {"rejections": {"flight.too_many_stops": []}}])
def test_diagnostico_vacio_o_malformado_no_rompe(req, diagnostics):
    assert rejection_counts(diagnostics) == {}
    facts = build_facts(req, {"diagnostics": diagnostics, "stats": "x"}, [])
    assert (facts.rejections, facts.date_options, facts.impossible_date_options) == ([], 0, 0)
    assert fallback_text(facts) == "No encontramos un viaje que cumpla todas tus condiciones."


def test_sin_restriccion_que_aflojar_no_hay_contrafactuales(req, offers):
    facts = asyncio.run(compute_facts(req, {"diagnostics": {"rejections": {"lodging.capacity": ["x"]}}}, offers,
                                      asyncio.Semaphore(1)))
    assert facts.relaxations == []


# ---------------------------------------------------------------- integridad (anti-alucinación)

def test_texto_fiel_a_los_hechos_pasa():
    assert violations(GOOD, FACTS) == []


@pytest.mark.parametrize(("text", "problem"), [
    ("Con 1 escala el viaje cuesta USD 18,500.00.", "número ausente en los hechos: 18,500.00"),
    ("Hay un vuelo que llega a las 22:30 si aceptás 1 escala.", "número ausente en los hechos: 22:30"),
    ("Probá saliendo desde MIA con 1 escala.", "código ausente en los hechos: MIA"),
    ("Con 1 escala ahorrás un 15% sobre USD 20,083.62.", "número ausente en los hechos: 15"),
    ("Mirá https://ejemplo.test para más opciones.", "formato o enlace no permitido"),
    ("- 7 vuelos descartados\n- 1 escala alcanza", "formato o enlace no permitido"),
    ("", "vacío"),
    ("a" * (MAX_CHARS + 1), "demasiado largo"),
])
def test_texto_con_datos_inventados_se_rechaza(text, problem):
    assert problem in violations(text, FACTS)


def test_respaldo_usa_solo_los_hechos_y_pasa_su_propio_control():
    text = fallback_text(FACTS)
    assert "7 vuelos con más escalas que tu máximo" in text
    assert "de 0 a 1, hay itinerario desde USD 20,083.62" in text
    assert violations(text, FACTS) == []
    none_feasible = FACTS.model_copy(update={"relaxations": [FACTS.relaxations[0].model_copy(
        update={"feasible": False, "best_total": None})]})
    assert "Aun flexibilizando escalas máximas por tramo" in fallback_text(none_feasible)
    assert violations(fallback_text(none_feasible), none_feasible) == []


# ---------------------------------------------------------------- adaptador de Gemini

def gemini(handler, timeout_s: float = 2.0) -> GeminiExplainer:
    return GeminiExplainer(KEY, "gemini-3.5-flash-lite", httpx.AsyncClient(transport=httpx.MockTransport(handler)),
                           timeout_s)


def ok_response(text: str, finish: str = "STOP") -> dict:
    return {"candidates": [{"content": {"role": "model", "parts": [{"text": text}]}, "finishReason": finish}]}


def test_gemini_pide_bien_y_devuelve_el_texto():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"], seen["key"] = str(request.url), request.headers.get("x-goog-api-key")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=ok_response(GOOD))

    assert asyncio.run(gemini(handler).explain(FACTS)) == GOOD
    assert seen["url"] == ENDPOINT.format(model="gemini-3.5-flash-lite")
    assert seen["key"] == KEY and KEY not in seen["url"]  # la clave nunca en la URL
    assert seen["body"]["systemInstruction"]["parts"][0]["text"].startswith("Sos el redactor de TravelOpt")
    assert FACTS.model_dump_json() in seen["body"]["contents"][0]["parts"][0]["text"]


@pytest.mark.parametrize("response", [
    httpx.Response(429, json={"error": {"status": "RESOURCE_EXHAUSTED"}}),
    httpx.Response(503, text="no"),
    httpx.Response(400, json={"error": {"status": "INVALID_ARGUMENT"}}),
    httpx.Response(200, json={"promptFeedback": {"blockReason": "SAFETY"}}),
    httpx.Response(200, json=ok_response("cortado", finish="MAX_TOKENS")),
    httpx.Response(200, json={"candidates": []}),
    httpx.Response(200, text="no es json"),
])
def test_gemini_falla_de_forma_controlada(response):
    with pytest.raises(ExplanationUnavailable):
        asyncio.run(gemini(lambda _: response).explain(FACTS))


def test_gemini_lento_corta_por_tiempo():
    async def slow(_: httpx.Request) -> httpx.Response:
        await asyncio.sleep(5)
        return httpx.Response(200, json=ok_response(GOOD))

    with pytest.raises(ExplanationUnavailable, match="tiempo agotado"):
        asyncio.run(gemini(slow, timeout_s=0.05).explain(FACTS))


def test_extraer_texto_ignora_pensamientos_y_partes_raras():
    data = {"candidates": [{"finishReason": "STOP", "content": {"parts": [
        {"text": "razonamiento", "thought": True}, {"text": "Hola. "}, {"inlineData": {}}, {"text": "Chau."}]}}]}
    assert extract_text(data) == "Hola. Chau."
    assert request_body(FACTS)["generationConfig"]["responseMimeType"] == "text/plain"


# ---------------------------------------------------------------- servicio

class FakeExplainer(GeminiExplainer):
    def __init__(self, text: str | None):
        super().__init__(KEY, "fake", httpx.AsyncClient(), 1.0)
        self.text, self.calls = text, 0

    async def explain(self, facts):
        self.calls += 1
        if self.text is None:
            raise ExplanationUnavailable("caído")
        return self.text


def run_explain(req, offers, explainer, cache=None):
    res = optimize(req, offers, "cpsat")

    async def load():
        return offers

    return asyncio.run(explain(f"run-{uuid.uuid4()}", req, summary_of(res), load, cache or MemoryCache(),
                               asyncio.Semaphore(1), explainer))


def test_sin_clave_explica_por_reglas(req, offers):
    out = run_explain(strict(req, max_stops=0), offers, None)
    assert out.source == "rules" and "USD 20,083.62" in out.text


def test_texto_valido_del_llm_se_muestra_y_se_guarda(req, offers):
    fake, cache = FakeExplainer("Sin escalas no hay viaje. Con 1 escala, el mejor cuesta USD 20,083.62."), MemoryCache()
    tight = strict(req, max_stops=0)
    assert run_explain(tight, offers, fake, cache).source == "ai"
    assert run_explain(tight, offers, fake, cache).source == "ai"
    assert fake.calls == 1  # la segunda vez sale de la caché: no gasta cuota del tier gratuito


def test_alucinacion_del_llm_no_llega_a_la_persona_ni_se_guarda(req, offers):
    fake, cache = FakeExplainer("Con 1 escala el viaje cuesta USD 9,999.99 y sale de MIA."), MemoryCache()
    tight = strict(req, max_stops=0)
    out = run_explain(tight, offers, fake, cache)
    assert out.source == "rules" and "9,999.99" not in out.text and "MIA" not in out.text
    run_explain(tight, offers, fake, cache)
    assert fake.calls == 2  # lo rechazado no se cachea: se vuelve a intentar


def test_llm_caido_explica_por_reglas(req, offers):
    out = run_explain(strict(req, max_stops=0), offers, FakeExplainer(None))
    assert out.source == "rules" and out.text.startswith("No encontramos un viaje")


# ---------------------------------------------------------------- API

def test_endpoint_solo_para_el_duenio_y_solo_sin_resultados(api):
    async def go():
        uid = str(uuid.uuid4())
        trip = {**TRIP, "constraints": {**TRIP["constraints"], "max_stops": 0}}
        rid = (await api.post("/v1/runs", json={"trip_request": trip, "user_id": uid, "trigger": False})).json()["run_id"]
        assert (await api.get(f"/v1/runs/{rid}/explanation", params={"uid": uid})).status_code == 409  # todavía corre
        assert (await api.post(f"/v1/runs/{rid}/run-all")).json()["status"] == "infeasible"
        assert (await api.get(f"/v1/runs/{rid}/explanation", params={"uid": str(uuid.uuid4())})).status_code == 404
        r = await api.get(f"/v1/runs/{rid}/explanation", params={"uid": uid})
        assert r.status_code == 200
        body = r.json()
        assert body["source"] == "rules" and "USD 20,083.62" in body["text"]
        assert body["facts"]["relaxations"][0]["proposed"] == "1"

    asyncio.run(go())


# ---------------------------------------------------------------- caso real: falla total sin alternativas

FALLA_TOTAL = FunnelFacts(
    destinations=["Orlando", "Nueva York"], travelers=2, rejections=[], impossible_date_options=1, date_options=1,
    impossible_reasons=[RejectionFact(what="sin vuelos para la ida a Orlando", count=1)], relaxations=[],
)
# Texto que Gemini generó en producción el 2026-11-11 para este caso: afirmaba que no había alternativas (no se
# evaluó ninguna), unía los destinos con "o" y abría con una muletilla.
TEXTO_REAL_RECHAZABLE = ("Che, probamos con 1 opción de fecha y la verdad es que no encontramos ningún viaje disponible "
                         "para 2 personas rumbo a Orlando o Nueva York. No hay opciones alternativas posibles en este "
                         "momento.")


def test_el_texto_real_de_produccion_ahora_se_rechaza():
    problems = violations(TEXTO_REAL_RECHAZABLE, FALLA_TOTAL)
    assert "habla de alternativas sin que se haya calculado ninguna" in problems
    assert "muletilla o disculpa" in problems


def test_falla_total_sin_alternativas_un_texto_fiel_pasa():
    ok = ("No encontramos un viaje para Orlando y Nueva York: en la única combinación de fechas evaluada no hay "
          "vuelos para la ida a Orlando.")
    assert violations(ok, FALLA_TOTAL) == []


def test_falla_total_sin_alternativas_el_respaldo_da_el_motivo_y_no_sugiere_nada():
    text = fallback_text(FALLA_TOTAL)
    assert text == ("No encontramos un viaje que cumpla todas tus condiciones. Motivo de fondo: sin vuelos para la "
                    "ida a Orlando (1 de 1 combinaciones de fechas).")
    assert violations(text, FALLA_TOTAL) == []


@pytest.mark.parametrize(("skeleton", "why", "expected"), [
    ("ORL-NYC|2026-11-11|7-4", "sin_vuelo:tramo_0", "sin vuelos para la ida a Orlando"),
    ("ORL-NYC|2026-11-11|7-4", "sin_vuelo:tramo_1", "sin vuelos para el tramo Orlando → Nueva York"),
    ("ORL-NYC|2026-11-11|7-4", "sin_vuelo:tramo_2", "sin vuelos para la vuelta desde Nueva York"),
    ("ORL-NYC|2026-11-11|7-4", "sin_alojamiento:NYC", "sin alojamiento que cumpla tus condiciones en Nueva York"),
    ("ORL-NYC|2026-11-11|7-4", "actividades_infactibles:ORL", "los imperdibles no entran en las noches de Orlando"),
    ("ORL-NYC|2026-11-11|7-4", "motivo_nuevo:ORL", None),   # desconocido: no se traduce a medias
    ("ORL-NYC|2026-11-11|7-4", "sin_vuelo:tramo_x", None),
    ("ORL-NYC|2026-11-11|7-4", "sin_texto", None),
    (None, "sin_vuelo:tramo_0", None),
    ("ORL-NYC|2026-11-11|7-4", 3, None),
])
def test_motivo_de_cada_combinacion_imposible(skeleton, why, expected):
    from app.explain.facts import impossible_reason
    assert impossible_reason(skeleton, why, {"ORL": "Orlando", "NYC": "Nueva York"}) == expected


def test_los_motivos_de_fondo_viajan_en_los_hechos(req):
    named = req.model_copy(update={"cities": [c.model_copy(update={"name": n}) for c, n in
                                              zip(req.cities, ["Orlando", "Nueva York"])]})
    summary = {"diagnostics": {"rejections": {}, "infeasible_skeletons": {
        "ORL-NYC|2027-07-08|8-4": "sin_vuelo:tramo_0", "ORL-NYC|2027-07-09|8-4": "sin_vuelo:tramo_0",
        "ORL-NYC|2027-07-10|8-4": "sin_alojamiento:NYC"}}, "stats": {"skeletons_total": 3}}
    facts = build_facts(named, summary, [])
    assert [(r.what, r.count) for r in facts.impossible_reasons] == [
        ("sin vuelos para la ida a Orlando", 2), ("sin alojamiento que cumpla tus condiciones en Nueva York", 1)]
    assert "Orlando" in facts.destinations and facts.relaxations == []
