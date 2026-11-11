"""Errores de render del navegador: los registra solo el motor, validados, con límite por usuario."""
import asyncio

from app.api.main import app

UID = "00000000-0000-4000-8000-0000000000aa"


def test_registra_el_error_validado(api):
    repo = app.state.repo
    r = asyncio.run(api.post("/v1/client-errors", json={"user_id": UID, "message": "TypeError: x is undefined",
                                                         "digest": "123abc", "path": "/runs/abc"}))
    assert r.status_code == 204
    assert repo.client_errors[-1] == {"user_id": UID, "message": "TypeError: x is undefined", "digest": "123abc",
                                      "path": "/runs/abc"}


def test_rechaza_campos_extra_rutas_raras_y_mensajes_enormes(api):
    bad = [{"user_id": UID, "message": "x", "extra": 1},
           {"user_id": UID, "message": "x", "path": "https://evil.example/"},
           {"user_id": UID, "message": "x" * 501},
           {"user_id": "no-es-uuid", "message": "x"}]
    for body in bad:
        assert asyncio.run(api.post("/v1/client-errors", json=body)).status_code == 422, body


def test_un_bucle_de_errores_no_inunda_la_base(api):
    repo = app.state.repo
    before = len(repo.client_errors)
    for _ in range(50):
        assert asyncio.run(api.post("/v1/client-errors", json={"user_id": UID, "message": "loop"})).status_code == 204
    assert len(repo.client_errors) - before <= 20
