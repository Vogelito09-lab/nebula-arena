"""Partida de exhibición: solo bots, mientras hay espectadores y ningún humano."""
import json

import juego
import server


def test_exhibicion_llena_la_arena_con_bots_y_corre_el_reloj():
    p = juego.Partida(semilla=1)
    assert p.iniciar_exhibicion(10.0)
    assert len(p.e) == 2 * juego.POR_EQUIPO and all(j["bot"] for j in p.e.values())
    t = 10.0
    for _ in range(100):                       # 5 s
        t += 0.05
        p.paso(t, 0.05)
    assert p.tiempo_restante(t) < juego.DURACION_S - 4


def test_exhibicion_no_se_inicia_si_hay_humanos():
    p = juego.Partida(semilla=1)
    p.unir("ana", 0, 0, "Ana", 1.0)
    assert not p.iniciar_exhibicion(2.0)
    assert not p.exhibicion


def test_un_humano_que_entra_reemplaza_la_exhibicion():
    p = juego.Partida(semilla=1)
    p.iniciar_exhibicion(0.0)
    p.marcador["azul"] = 7
    p.unir("ana", 0, 0, "Ana", 30.0)
    assert not p.exhibicion
    assert p.marcador == {"azul": 0, "rojo": 0}
    assert p.inicio == 30.0                    # el reloj empieza con el humano
    assert len(p.humanos()) == 1 and len(p.e) == 2 * juego.POR_EQUIPO


def test_terminar_exhibicion_vacia_la_arena():
    p = juego.Partida(semilla=1)
    p.iniciar_exhibicion(0.0)
    p.terminar_exhibicion()
    assert p.e == {} and not p.exhibicion
    assert p.tiempo_restante(100.0) == juego.DURACION_S


def test_la_exhibicion_se_repite_al_terminar_la_partida():
    p = juego.Partida(semilla=1)
    p.iniciar_exhibicion(0.0)
    p.marcador["rojo"] = juego.META_BAJAS
    p.paso(0.05, 0.05)
    assert p.fin and p.fin["ganador"] == "rojo"
    p.paso(0.05 + juego.PAUSA_FIN_S, 0.05)
    assert p.fin is None and p.exhibicion and len(p.e) == 2 * juego.POR_EQUIPO


def test_snapshot_marca_la_exhibicion():
    server.motor.iniciar_exhibicion(0.0)
    try:
        assert json.loads(server.snapshot(ahora=0.0))["ex"] is True
    finally:
        server.motor.terminar_exhibicion()
    assert json.loads(server.snapshot(ahora=0.0))["ex"] is False
