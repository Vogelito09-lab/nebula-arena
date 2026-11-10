"""Elección de escuadrón: el jugador puede pedir azul o rojo al unirse.
El servidor lo respeta mientras ese equipo tenga lugar para humanos."""
import juego
import server
from juego import POR_EQUIPO


def test_respeta_el_escuadron_pedido():
    p = juego.Partida(semilla=1)
    assert p.unir("ana", 0, 0, equipo="rojo")["equipo"] == "rojo"


def test_sin_preferencia_sigue_balanceando():
    p = juego.Partida(semilla=1)
    assert p.unir("ana", 0, 0)["equipo"] == "azul"
    assert p.unir("beto", 0, 0)["equipo"] == "rojo"


def test_los_bots_ceden_su_lugar_y_sigue_siendo_5_vs_5():
    p = juego.Partida(semilla=1)
    p.unir("ana", 0, 0, equipo="rojo")
    for eq in juego.EQUIPOS:
        assert sum(1 for j in p.e.values() if j["equipo"] == eq) == POR_EQUIPO
    assert not p.e["ana"]["bot"]


def test_equipo_lleno_de_humanos_asigna_el_otro():
    p = juego.Partida(semilla=1)
    for i in range(POR_EQUIPO):
        p.unir(f"r{i}", 0, 0, equipo="rojo")
    assert p.unir("extra", 0, 0, equipo="rojo")["equipo"] == "azul"


def test_validar_acepta_escuadron_valido_y_rechaza_otro():
    ok = server.validar({"id": "ana", "x": 1, "y": 1, "equipo": "rojo"}, None)
    assert ok["equipo"] == "rojo"
    assert server.validar({"id": "ana", "x": 1, "y": 1, "equipo": "verde"}, None) is None
    assert "equipo" not in server.validar({"id": "ana", "x": 1, "y": 1}, None)
