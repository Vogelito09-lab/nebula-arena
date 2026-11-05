"""Pruebas unitarias del servidor (las dos primeras vienen del material 3.3)."""
import asyncio
import json

import server


def test_snapshot_incluye_a_los_jugadores():
    server.estado.clear()
    server.estado["ana"] = {"id": "ana", "x": 1.0, "y": 2.0}
    assert json.loads(server.snapshot())["e"]["ana"]["x"] == 1.0
    server.estado.clear()


def test_partida_es_5_vs_5():
    assert server.MAX_JUGADORES == 10


def test_tick_es_20_hz():
    assert abs(1 / server.TICK_S - 20) < 1e-9


def test_validar_acepta_mensaje_correcto():
    d = server.validar({"id": "ana", "x": 10, "y": 20.5, "dispara": True}, None)
    assert d == {"id": "ana", "x": 10.0, "y": 20.5, "dispara": True}


def test_validar_rechaza_coordenadas_fuera_de_la_arena():
    assert server.validar({"id": "ana", "x": -1, "y": 5}, None) is None
    assert server.validar({"id": "ana", "x": 5, "y": 1e9}, None) is None


def test_validar_rechaza_tipos_incorrectos():
    assert server.validar({"id": "ana", "x": "5", "y": 5}, None) is None
    assert server.validar({"id": "ana", "x": True, "y": 5}, None) is None
    assert server.validar({"id": "ana", "x": float("nan"), "y": 5}, None) is None
    assert server.validar({"id": 7, "x": 5, "y": 5}, None) is None
    assert server.validar({"id": "", "x": 5, "y": 5}, None) is None
    assert server.validar({"id": "a" * 33, "x": 5, "y": 5}, None) is None
    assert server.validar([1, 2, 3], None) is None


def test_validar_impide_suplantar_a_otro_jugador():
    assert server.validar({"id": "beto", "x": 5, "y": 5}, "ana") is None


def test_dispara_solo_si_es_true_literal():
    d = server.validar({"id": "ana", "x": 1, "y": 1, "dispara": "si"}, None)
    assert d["dispara"] is False


def test_ready_se_reintenta_hasta_que_el_sidecar_responde(monkeypatch):
    # El sidecar de Agones tarda en arrancar: las 3 primeras llamadas fallan.
    respuestas = iter([False, False, False, True])
    llamadas = []

    def agones_falso(ruta):
        llamadas.append(ruta)
        return next(respuestas)

    monkeypatch.setattr(server, "agones", agones_falso)
    intentos = asyncio.run(server.anunciar_ready(intervalo=0))
    assert intentos == 4 and llamadas == ["/ready"] * 4


def test_agones_fuera_del_cluster_no_truena():
    # Sin el contenedor del SDK la llamada falla y se ignora.
    assert server.agones("/health") in (True, False)
