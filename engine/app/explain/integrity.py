"""Chequeo de integridad del texto generado, y explicación de respaldo sin LLM.

El texto del LLM solo se muestra si no afirma nada que no esté en los hechos:
- todo número (cantidades, montos, horas, porcentajes) tiene que aparecer en el payload;
- todo código en mayúsculas de 3 letras (aeropuerto, moneda) también;
- ninguna URL, email ni formato de lista o encabezado;
- largo acotado.
Si algo falla, se descarta el texto entero y se muestra la explicación de respaldo, armada con plantillas a partir de
los mismos hechos. Es un control conservador: puede rechazar un texto correcto, nunca deja pasar un número inventado.
"""
from __future__ import annotations

import re

from app.explain.facts import FunnelFacts

MAX_CHARS = 900
_NUMBER = re.compile(r"\d+(?:[.,:]\d+)*")
_CODE = re.compile(r"\b[A-Z]{3}\b")
_FORBIDDEN = re.compile(r"https?://|www\.|@|^\s*(?:#|[-*•]\s|\d+\.\s)", re.MULTILINE)


def _numbers(text: str) -> set[str]:
    return {m.group(0).rstrip(".,:") for m in _NUMBER.finditer(text)}


def _digits(token: str) -> str:
    return re.sub(r"\D", "", token)


def violations(text: str, facts: FunnelFacts) -> list[str]:
    """Lista de problemas del texto respecto de los hechos; vacía si se puede mostrar."""
    source = facts.model_dump_json()
    problems: list[str] = []
    if not text.strip():
        problems.append("vacío")
    if len(text) > MAX_CHARS:
        problems.append("demasiado largo")
    if _FORBIDDEN.search(text):
        problems.append("formato o enlace no permitido")
    allowed = _numbers(source)
    allowed_digits = {_digits(n) for n in allowed}
    for n in sorted(_numbers(text)):
        if n not in allowed and _digits(n) not in allowed_digits:
            problems.append(f"número ausente en los hechos: {n}")
    for code in sorted(set(_CODE.findall(text))):
        if code not in source:
            problems.append(f"código ausente en los hechos: {code}")
    return problems


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else f"{', '.join(items[:-1])} y {items[-1]}"


def fallback_text(facts: FunnelFacts) -> str:
    """Explicación determinística, sin LLM: misma información, redacción por plantilla."""
    parts = ["No encontramos un viaje que cumpla todas tus condiciones."]
    if facts.rejections:
        top = [f"{r.count} {r.what}" for r in facts.rejections[:3]]
        parts.append(f"Lo que más opciones descartó: {_join(top)}.")
    feasible = next((r for r in facts.relaxations if r.feasible), None)
    if feasible is not None:
        parts.append(f"Si cambiás {feasible.setting} de {feasible.current} a {feasible.proposed}, "
                     f"hay itinerario desde {feasible.best_total}.")
    elif facts.relaxations:
        tried = _join([r.setting for r in facts.relaxations])
        parts.append(f"Ni flexibilizando {tried} aparece un viaje posible: probá con otras fechas o más noches.")
    return " ".join(parts)
