"""Explicación de una búsqueda sin resultados: hechos (con contrafactuales del optimizador), redacción y control.

Flujo:
1. Hechos del embudo. Se calculan una vez por búsqueda y quedan en la caché: la búsqueda terminada no cambia, y
   pedidos simultáneos comparten el cálculo (deduplicación de `cached_entry`).
2. Redacción con Gemini, si hay clave. El texto se guarda en la caché por contenido de los hechos, solo si pasó el
   control de integridad: una falla del LLM no se guarda y el próximo pedido vuelve a intentar.
3. Si no hay clave, el LLM falla, tarda o el texto no pasa el control, la explicación de respaldo (plantillas).
Ninguna falla llega a la persona como error.
"""
from __future__ import annotations

import asyncio
from typing import Awaitable, Callable, Literal

from pydantic import BaseModel

from app.domain.models import OfferSet, TripRequest
from app.domain.legal import SEED_RULES, LegalRules
from app.explain.facts import (FunnelFacts, build_facts, legal_facts, rejection_counts, relaxation_fact,
                               relaxed_requests)
from app.explain.gemini import GeminiExplainer, ExplanationUnavailable
from app.explain.integrity import fallback_text, violations
from app.optimizer.solver import optimize
from app.services.alerts import report
from app.services.cache import Cache, cache_key, cached_entry

FACTS_VERSION = "explain-facts-v3"
CACHE_TTL_S = 30 * 24 * 3600  # lo mismo que vive la búsqueda (retención de 30 días)


class Explanation(BaseModel):
    text: str
    source: Literal["ai", "rules"]
    facts: FunnelFacts


async def compute_facts(req: TripRequest, summary: dict, offers: OfferSet, slots: asyncio.Semaphore,
                        legal: LegalRules = SEED_RULES) -> FunnelFacts:
    """Corre el optimizador una vez por restricción aflojada, sobre las mismas ofertas (ninguna API externa)."""
    counts = rejection_counts(summary.get("diagnostics"))
    relaxations = []
    for lever, current, proposed, relaxed in relaxed_requests(req, counts):
        async with slots:  # mismo tope de CP-SAT simultáneos que las búsquedas
            res = await asyncio.to_thread(optimize, relaxed, offers, "cpsat")
        best = res.itineraries[0].total_minor if res.itineraries else None
        relaxations.append(relaxation_fact(lever, current, proposed, best))
    return build_facts(req, summary, relaxations, legal_facts(req, counts, legal))


async def explain(run_id: str, req: TripRequest, summary: dict, load_offers: Callable[[], Awaitable[OfferSet]],
                  cache: Cache, slots: asyncio.Semaphore, explainer: GeminiExplainer | None,
                  legal: LegalRules = SEED_RULES) -> Explanation:
    async def facts_fetch() -> dict:
        offers = await load_offers()
        return (await compute_facts(req, summary, offers, slots, legal)).model_dump(mode="json")

    entry, _ = await cached_entry(cache, cache_key(FACTS_VERSION, "run", {"run": run_id}), FACTS_VERSION, CACHE_TTL_S,
                                  facts_fetch)
    facts = FunnelFacts.model_validate(entry.value)
    if explainer is None:
        return Explanation(text=fallback_text(facts), source="rules", facts=facts)

    key = cache_key("gemini", explainer.model, {"facts": facts.model_dump(mode="json")})
    hit = await cache.entry(key)
    if hit is not None and isinstance(hit.value, str):
        return Explanation(text=hit.value, source="ai", facts=facts)
    try:
        text = await explainer.explain(facts)
    except ExplanationUnavailable as exc:
        report("explanation_unavailable", "warning", provider="gemini", error=str(exc)[:80])
        return Explanation(text=fallback_text(facts), source="rules", facts=facts)
    problems = violations(text, facts)
    if problems:
        # el texto no se muestra ni se guarda; solo el motivo, sin el texto (puede repetir datos del pedido)
        report("explanation_rejected", "warning", provider="gemini", error="; ".join(problems)[:200])
        return Explanation(text=fallback_text(facts), source="rules", facts=facts)
    await cache.set(key, "gemini", text, CACHE_TTL_S)
    return Explanation(text=text, source="ai", facts=facts)
