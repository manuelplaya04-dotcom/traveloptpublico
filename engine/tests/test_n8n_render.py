"""scripts/n8n_render.py: workflows de producción con la URL del motor validada."""
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("n8n_render", ROOT / "scripts" / "n8n_render.py")
n8n_render = importlib.util.module_from_spec(spec)
spec.loader.exec_module(n8n_render)


@pytest.mark.parametrize("url", ["http://motor.example.com", "https://u:p@motor.example.com",
                                 "https://motor.example.com/v1", "https://motor.example.com?x=1", "ftp://x", "https://"])
def test_rejects_unsafe_engine_urls(url):
    with pytest.raises(ValueError):
        n8n_render.validate_engine_url(url)


def test_replaces_every_engine_url_and_keeps_valid_json():
    url = n8n_render.validate_engine_url("https://motor.example.com/")
    assert url == "https://motor.example.com"
    seen = 0
    for src in sorted(n8n_render.SRC.glob("*.json")):
        text = src.read_text(encoding="utf-8")
        seen += text.count(n8n_render.LOCAL_ENGINE_URL)
        out = n8n_render.render(text, url)
        assert n8n_render.LOCAL_ENGINE_URL not in out and "host.docker.internal" not in out
        json.loads(out)
    assert seen == 2  # Config de wf01 y Reap de wf03: si aparece otra, revisar que el script la cubra
