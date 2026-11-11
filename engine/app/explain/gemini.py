"""Adaptador de Gemini (API REST generateContent) para redactar la explicación del embudo.

Una sola llamada, sin reintentos y con tope de tiempo: la explicación es un extra y la persona ya tiene la de respaldo.
Pasa por el cliente HTTP del motor (lista blanca de salida, circuit breaker por proveedor). La clave va en el header
`x-goog-api-key`, nunca en la URL, así no aparece en logs ni en las estadísticas de llamadas.
"""
from __future__ import annotations

import asyncio

import httpx

from app.explain.facts import FunnelFacts
from app.services.http import UpstreamError, fetch_json

PROVIDER = "gemini"
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
MAX_OUTPUT_TOKENS = 400

SYSTEM_PROMPT = """\
Sos el redactor de TravelOpt, un optimizador de viajes. Tu única tarea es traducir a lenguaje natural un JSON de \
"hechos del embudo" que explica por qué una búsqueda no encontró ningún viaje que cumpla las condiciones de la persona.

Reglas obligatorias:
1. Usá SOLO la información del JSON. No agregues hechos, causas, consejos ni contexto propio.
2. Cada número, monto, hora o porcentaje que escribas tiene que aparecer tal cual en el JSON. No calcules, no redondees, \
no conviertas monedas, no sumes.
3. No sugieras otros destinos, fechas, aerolíneas, hoteles ni proveedores. No menciones reglas o restricciones que no \
estén en el JSON.
4. Si "relaxations" tiene un elemento con "feasible": true, explicá ese cambio y su resultado ("best_total") como la \
salida principal. Si ninguno es factible, decí que aflojar esas condiciones tampoco alcanza.
5. Tono empático y directo, en español rioplatense (vos). Entre 2 y 4 oraciones, máximo 90 palabras.
6. Texto plano: sin listas, sin títulos, sin negritas, sin enlaces, sin emojis.
7. Si el JSON no alcanza para explicar algo, no lo expliques.
"""


class ExplanationUnavailable(RuntimeError):
    """El LLM no respondió a tiempo, rechazó el pedido o devolvió algo que no se puede usar."""


def request_body(facts: FunnelFacts) -> dict:
    return {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": f"Hechos del embudo (JSON):\n{facts.model_dump_json()}"}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": MAX_OUTPUT_TOKENS, "responseMimeType": "text/plain"},
    }


def extract_text(data: object) -> str:
    """Texto de la primera respuesta, o ExplanationUnavailable si el pedido fue bloqueado, se cortó o vino vacío."""
    if not isinstance(data, dict):
        raise ExplanationUnavailable("respuesta inesperada")
    feedback = data.get("promptFeedback")
    if isinstance(feedback, dict) and feedback.get("blockReason"):
        raise ExplanationUnavailable(f"bloqueado: {feedback['blockReason']}")
    candidates = data.get("candidates")
    first = candidates[0] if isinstance(candidates, list) and candidates else None
    if not isinstance(first, dict) or first.get("finishReason") != "STOP":
        reason = first.get("finishReason") if isinstance(first, dict) else "sin candidatos"
        raise ExplanationUnavailable(f"respuesta incompleta: {reason}")
    content = first.get("content")
    parts = content.get("parts") if isinstance(content, dict) else None
    text = "".join(p["text"] for p in parts or [] if isinstance(p, dict) and isinstance(p.get("text"), str)
                   and not p.get("thought"))
    if not text.strip():
        raise ExplanationUnavailable("respuesta vacía")
    return text.strip()


class GeminiExplainer:
    def __init__(self, api_key: str, model: str, client: httpx.AsyncClient, timeout_s: float):
        self.api_key, self.model, self.client, self.timeout_s = api_key, model, client, timeout_s

    async def explain(self, facts: FunnelFacts) -> str:
        try:
            async with asyncio.timeout(self.timeout_s):
                data = await fetch_json(
                    self.client, "POST", ENDPOINT.format(model=self.model), provider=PROVIDER,
                    json=request_body(facts), headers={"x-goog-api-key": self.api_key}, max_attempts=1,
                )
        except TimeoutError as exc:
            raise ExplanationUnavailable("tiempo agotado") from exc
        except (UpstreamError, httpx.HTTPError, ValueError) as exc:  # incluye 429, 5xx, circuito abierto y JSON roto
            raise ExplanationUnavailable(type(exc).__name__) from exc
        return extract_text(data)
