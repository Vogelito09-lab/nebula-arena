import pytest

import matchmaker


@pytest.fixture
def cliente():
    matchmaker.app.config["TESTING"] = True
    return matchmaker.app.test_client()


def test_rechaza_jugador_invalido(cliente):
    assert cliente.post("/match", json={}).status_code == 400
    assert cliente.post("/match", json={"jugador": "a b"}).status_code == 400
    assert cliente.post("/match", json={"jugador": "x" * 33}).status_code == 400
    assert cliente.post("/match", data="no json").status_code == 400


def test_devuelve_servidor_asignado(cliente, monkeypatch):
    monkeypatch.setattr(matchmaker, "asignar", lambda: {
        "state": "Allocated", "address": "10.0.0.5", "gameServerName": "gs-1",
        "ports": [{"name": "game", "port": 7123}]})
    r = cliente.post("/match", json={"jugador": "ana"})
    assert r.status_code == 200
    assert r.get_json() == {"address": "10.0.0.5", "port": 7123, "gameServerName": "gs-1"}


def test_sin_servidores_responde_503(cliente, monkeypatch):
    monkeypatch.setattr(matchmaker, "asignar", lambda: None)
    assert cliente.post("/match", json={"jugador": "ana"}).status_code == 503


def test_agones_caido_responde_502(cliente, monkeypatch):
    def falla():
        raise OSError("sin conexión")
    monkeypatch.setattr(matchmaker, "asignar", falla)
    assert cliente.post("/match", json={"jugador": "ana"}).status_code == 502


def test_metricas_y_salud(cliente):
    assert cliente.get("/healthz").data == b"ok"
    assert b"nebula_match_requests_total" in cliente.get("/metrics").data
