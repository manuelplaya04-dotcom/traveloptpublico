"""Eventos operativos y alertas (cuota agotada, fallas parciales, cron que no corrió…).

Un solo punto de entrada: `report("evento", **contexto)`:

1. Escribe una línea JSON en el log (`travelopt.alerts`) y cuenta cuántas veces pasó (`counts()`, panel de cuota).
2. Si hay webhook configurado (`ALERT_WEBHOOK_URL`, secreto del entorno: Discord, Slack o Telegram), manda un aviso
   **asíncrono**: nunca bloquea ni rompe el flujo que reporta (un webhook caído solo deja una línea en el log).

**Throttling (anti alert fatigue):** como máximo un aviso por tipo de evento cada `THROTTLE_S` (15 min). Los que llegan
dentro de la ventana se cuentan y el próximo aviso dice "(+N similares desde el anterior)". Si SerpApi rechaza 50
veces en un minuto, llega 1 mensaje, no 50.

**Privacidad (ISO 27001, Ley 25.326):** el contexto pasa por una lista blanca de claves y valores primitivos; los
textos se recortan y se les borra cualquier cosa con forma de URL, IP, email o token. Nunca viajan datos de usuarios.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections import Counter
from datetime import UTC, datetime
from typing import Literal
from urllib.parse import urlsplit

import httpx

logger = logging.getLogger("travelopt.alerts")
_counts: Counter[str] = Counter()

Level = Literal["info", "warning", "error"]
THROTTLE_S = 15 * 60
# hosts de webhook admitidos (además en la lista blanca de salida del cliente HTTP)
WEBHOOK_HOSTS = frozenset({"discord.com", "discordapp.com", "hooks.slack.com", "api.telegram.org"})
# claves de contexto que pueden salir al webhook (todo lo demás queda solo en el log del servidor)
SAFE_KEYS = frozenset({"provider", "kind", "kinds", "error", "city", "failed", "total", "code"})
_SCRUB = re.compile(r"https?://\S+|\b\d{1,3}(?:\.\d{1,3}){3}\b|[\w.+-]+@[\w-]+\.[\w.]+|\b[A-Za-z0-9_-]{24,}\b")


class _Webhook:
    def __init__(self) -> None:
        self.url: str | None = None
        self.client: httpx.AsyncClient | None = None
        self.env = "local"
        self.last_sent: dict[str, float] = {}
        self.suppressed: Counter[str] = Counter()
        self.clock = time.monotonic
        self.tasks: set[asyncio.Task] = set()


_hook = _Webhook()


def configure(url: str | None, client: httpx.AsyncClient | None, env: str) -> None:
    """Se llama al arrancar el motor. Una URL fuera de los hosts admitidos o sin https deja el webhook apagado."""
    _hook.url = url if url and _valid(url) else None
    _hook.client, _hook.env = client, env
    if url and _hook.url is None:
        logger.error(json.dumps({"event": "alert_webhook_rejected", "reason": "host o esquema no permitido"}))


def _valid(url: str) -> bool:
    u = urlsplit(url)
    return u.scheme == "https" and u.hostname in WEBHOOK_HOSTS and not u.username and u.port in (None, 443)


def sanitize(context: dict) -> dict:
    out: dict[str, str | int | float | bool] = {}
    for k, v in context.items():
        if k not in SAFE_KEYS or v is None:
            continue
        if isinstance(v, (bool, int, float)):
            out[k] = v
        else:
            out[k] = _SCRUB.sub("[…]", str(v))[:80]
    return out


def _body(url: str, text: str) -> dict:
    host = urlsplit(url).hostname
    if host == "api.telegram.org":
        return {"text": text}  # la URL ya trae el chat_id: /bot<token>/sendMessage?chat_id=…
    if host == "hooks.slack.com":
        return {"text": text}
    return {"content": text}  # Discord


async def _send(url: str, text: str) -> None:
    from app.services.http import check_egress

    try:
        check_egress(url)
        assert _hook.client is not None
        r = await _hook.client.post(url, json=_body(url, text), timeout=5.0, follow_redirects=False)
        if r.status_code >= 400:
            logger.warning(json.dumps({"event": "alert_webhook_failed", "status": r.status_code}))
    except (httpx.HTTPError, ValueError) as exc:  # ValueError: EgressBlocked
        logger.warning(json.dumps({"event": "alert_webhook_failed", "error": type(exc).__name__}))


def _should_send(event: str) -> tuple[bool, int]:
    """(mandar ahora, cuántos se suprimieron desde el último aviso de este tipo)."""
    now = _hook.clock()
    last = _hook.last_sent.get(event)
    if last is not None and now - last < THROTTLE_S:
        _hook.suppressed[event] += 1
        return False, 0
    _hook.last_sent[event] = now
    return True, _hook.suppressed.pop(event, 0)


def report(event: str, level: Level = "warning", **context: str | int | float | bool | None) -> None:
    _counts[event] += 1
    line = json.dumps({"event": event, "at": datetime.now(UTC).isoformat(), **context}, default=str)
    getattr(logger, level)(line)
    if level == "info" or not _hook.url or _hook.client is None:
        return
    send, suppressed = _should_send(event)
    if not send:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return  # fuera del event loop (scripts): solo log
    safe = sanitize(context)
    detail = " · ".join(f"{k}={v}" for k, v in sorted(safe.items()))
    more = f" (+{suppressed} similares desde el anterior)" if suppressed else ""
    text = f"[TravelOpt {_hook.env}] {'🔴' if level == 'error' else '🟠'} {event}{more}" + (f" · {detail}" if detail else "")
    task = loop.create_task(_send(_hook.url, text))
    _hook.tasks.add(task)
    task.add_done_callback(_hook.tasks.discard)


def counts() -> dict[str, int]:
    return dict(_counts)
