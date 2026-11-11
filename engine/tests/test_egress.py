"""Anti-SSRF: el cliente HTTP del motor rechaza cualquier destino fuera de la lista blanca, sin conectarse."""
import asyncio

import httpx
import pytest

from app.services.http import EgressBlocked, check_egress, fetch_json


@pytest.mark.parametrize("url", [
    "https://api.open-meteo.com/v1/forecast",
    "https://archive-api.open-meteo.com/v1/archive?latitude=1",
    "https://api.openweathermap.org:443/data/3.0/onecall",
])
def test_allows_listed_hosts(url):
    check_egress(url)


@pytest.mark.parametrize("url", [
    "http://api.open-meteo.com/v1/forecast",               # sin TLS
    "https://169.254.169.254/latest/meta-data/",           # metadata de la nube
    "https://localhost/v1/maintenance/reap",               # servicios internos
    "https://127.0.0.1:8000/healthz",
    "https://api.open-meteo.com.evil.com/x",               # sufijo engañoso
    "https://evil.com#@api.open-meteo.com",
    "https://user:pw@api.open-meteo.com/x",                # credenciales embebidas
    "https://api.open-meteo.com:8443/x",                   # puerto no estándar
    "file:///etc/passwd",
    "gopher://api.open-meteo.com/",
])
def test_blocks_everything_else(url):
    with pytest.raises(EgressBlocked):
        check_egress(url)


def test_fetch_json_blocks_before_connecting():
    calls = []

    async def go():
        client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: calls.append(r) or httpx.Response(200)))
        with pytest.raises(EgressBlocked):
            await fetch_json(client, "GET", "https://169.254.169.254/", provider="ssrf")

    asyncio.run(go())
    assert calls == []
