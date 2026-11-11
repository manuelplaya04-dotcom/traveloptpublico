"""Genera los workflows de n8n para un entorno desplegado, con la URL del motor en un solo lugar.

Los nodos de n8n no leen variables de entorno (N8N_BLOCK_ENV_ACCESS_IN_NODE), así que la URL del motor es un literal
en los JSON versionados (la local). Este script la reemplaza y escribe el resultado en n8n/dist/ (ignorado por git),
listo para `n8n import:workflow`.

    uv run --project engine python scripts/n8n_render.py --engine-url https://motor.up.railway.app
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SRC, DIST = ROOT / "n8n" / "workflows", ROOT / "n8n" / "dist"
LOCAL_ENGINE_URL = "http://host.docker.internal:8000"


def validate_engine_url(url: str) -> str:
    """La clave del motor viaja en cada llamada: solo https, sin credenciales, ruta, query ni fragmento."""
    u = urlsplit(url.rstrip("/"))
    if u.scheme != "https" or not u.hostname or u.username or u.password or u.path or u.query or u.fragment:
        raise ValueError("--engine-url debe ser https://host[:puerto], sin ruta ni credenciales")
    return f"https://{u.netloc}"


def render(text: str, engine_url: str) -> str:
    if LOCAL_ENGINE_URL not in text:
        return text
    out = text.replace(LOCAL_ENGINE_URL, engine_url)
    json.loads(out)  # sigue siendo un workflow válido
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--engine-url", required=True)
    args = p.parse_args(argv)
    try:
        engine_url = validate_engine_url(args.engine_url)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    DIST.mkdir(exist_ok=True)
    for src in sorted(SRC.glob("*.json")):
        text = src.read_text(encoding="utf-8")
        n = text.count(LOCAL_ENGINE_URL)
        (DIST / src.name).write_text(render(text, engine_url), encoding="utf-8")
        print(f"{src.name}: {n} URL(s) del motor -> {engine_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
