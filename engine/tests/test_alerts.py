"""Alertas por webhook: throttling por tipo, sin datos personales ni secretos, y nunca rompen el flujo."""
import asyncio

import httpx
import pytest

from app.services import alerts

DISCORD = "https://discord.com/api/webhooks/123/secreto"


@pytest.fixture(autouse=True)
def _fresh_hook(monkeypatch):
    hook = alerts._Webhook()
    t = {"now": 1000.0}
    hook.clock = lambda: t["now"]
    monkeypatch.setattr(alerts, "_hook", hook)
    yield t
    alerts.configure(None, None, "local")


def _wire(handler):
    sent = []

    def h(r):
        sent.append(r)
        return handler(r)

    alerts.configure(DISCORD, httpx.AsyncClient(transport=httpx.MockTransport(h)), "production")
    return sent


async def _drain():
    await asyncio.gather(*list(alerts._hook.tasks))


def test_cincuenta_rechazos_en_un_minuto_son_un_solo_aviso(_fresh_hook):
    sent = _wire(lambda r: httpx.Response(204))

    async def go():
        for _ in range(50):
            alerts.report("serpapi_quota_exhausted", "error", provider="serpapi_google_flights")
            _fresh_hook["now"] += 1
        await _drain()
        assert len(sent) == 1
        _fresh_hook["now"] += alerts.THROTTLE_S  # pasada la ventana, el próximo sale y resume lo suprimido
        alerts.report("serpapi_quota_exhausted", "error", provider="serpapi_google_flights")
        await _drain()
        assert len(sent) == 2 and "(+49 similares desde el anterior)" in sent[1].content.decode()

    asyncio.run(go())


def test_el_throttling_es_por_tipo_de_evento():
    sent = _wire(lambda r: httpx.Response(204))

    async def go():
        alerts.report("serpapi_quota_exhausted", "error")
        alerts.report("run_extraction_failed", "error")
        await _drain()
        assert len(sent) == 2

    asyncio.run(go())


def test_el_aviso_no_lleva_datos_personales_ni_secretos():
    sent = _wire(lambda r: httpx.Response(204))

    fake = "tok" + "Q7" * 15  # se arma en tiempo de ejecución: un literal con forma de clave dispara gitleaks

    async def go():
        alerts.report("ticketmaster_unavailable", error=f"fallo en https://x.example/?a=b para 190.12.4.7 user@mail.com {fake}",
                      user_id="00000000-0000-4000-8000-0000000000aa", provider="ticketmaster_discovery", secret=fake)
        await _drain()
        body = sent[0].content.decode()
        for leak in ("x.example", "190.12.4.7", "user@mail.com", "00000000-0000", fake, "secreto"):
            assert leak not in body
        assert "ticketmaster_discovery" in body and "TravelOpt production" in body

    asyncio.run(go())


def test_un_webhook_caido_no_rompe_el_flujo_que_reporta():
    _wire(lambda r: (_ for _ in ()).throw(httpx.ConnectError("caído")))

    async def go():
        alerts.report("run_extraction_failed", "error", kinds="flights")  # no lanza
        await _drain()
        assert alerts.counts()["run_extraction_failed"] >= 1

    asyncio.run(go())


def test_host_no_permitido_o_sin_https_deja_el_webhook_apagado():
    alerts.configure("https://evil.example/hook", httpx.AsyncClient(), "production")
    assert alerts._hook.url is None
    alerts.configure("http://discord.com/api/webhooks/1/x", httpx.AsyncClient(), "production")
    assert alerts._hook.url is None
    alerts.configure(DISCORD, httpx.AsyncClient(), "production")
    assert alerts._hook.url == DISCORD


def test_formato_por_plataforma():
    assert alerts._body(DISCORD, "x") == {"content": "x"}
    assert alerts._body("https://hooks.slack.com/services/a/b/c", "x") == {"text": "x"}
    assert alerts._body("https://api.telegram.org/botX/sendMessage?chat_id=1", "x") == {"text": "x"}


def test_info_y_sin_webhook_solo_van_al_log():
    async def go():
        alerts.report("algo", "warning")  # sin configurar: no hay tareas
        assert not alerts._hook.tasks

    asyncio.run(go())
