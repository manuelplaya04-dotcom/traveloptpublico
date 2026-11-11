"""El motor no habla con navegadores: solo con el servidor de Next (Bearer ENGINE_API_KEY). Por eso no tiene
CORSMiddleware: sin `Access-Control-Allow-Origin`, ningún sitio puede leer sus respuestas desde un navegador. Este test
impide que alguien agregue un CORS permisivo sin querer."""
import asyncio

import pytest

ORIGINS = ["https://evil.example", "http://localhost:3000", "null"]


@pytest.mark.parametrize("origin", ORIGINS)
def test_ningun_origen_puede_leer_respuestas_desde_un_navegador(api, origin):
    async def go():
        async with api as c:
            pre = await c.options("/v1/runs", headers={
                "Origin": origin, "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type"})
            get = await c.get("/healthz", headers={"Origin": origin})
        return pre, get

    pre, get = asyncio.run(go())
    for r in (pre, get):
        assert "access-control-allow-origin" not in r.headers
        assert "access-control-allow-credentials" not in r.headers
    assert pre.status_code in (404, 405)  # sin preflight: el navegador bloquea el pedido real


def test_sin_documentacion_publica_del_contrato(api):
    async def go():
        async with api as c:
            return [(await c.get(p)).status_code for p in ("/docs", "/redoc", "/openapi.json")]

    assert asyncio.run(go()) == [404, 404, 404]
