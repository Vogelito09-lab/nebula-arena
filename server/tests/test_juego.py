"""Reglas del juego (servidor autoritativo) sin red."""
import asyncio
import json
import math

import websockets

import juego
import server


def partida():
    return juego.Partida(semilla=1)


def test_un_humano_se_completa_a_5_vs_5_con_bots():
    p = partida()
    p.unir("ana", 3, 4, "Ana")
    assert len(p.e) == 10
    for eq in juego.EQUIPOS:
        assert sum(1 for j in p.e.values() if j["equipo"] == eq) == 5
    assert sum(1 for j in p.e.values() if j["bot"]) == 9


def test_el_reloj_empieza_con_el_primer_humano_y_bots_sin_nombres_repetidos():
    p = partida()
    p.unir("ana", 3, 4, ahora=1000.0)               # servidor lleva mucho tiempo encendido
    assert p.tiempo_restante(1000.0) == juego.DURACION_S
    assert not p.paso(1000.05, 0.05) and p.fin is None
    nombres = [j["nombre"] for j in p.e.values()]
    assert len(nombres) == len(set(nombres))


def test_los_humanos_reemplazan_bots_y_sin_humanos_no_hay_bots():
    p = partida()
    p.unir("ana", 3, 4)
    p.unir("beto", 3, 6)
    assert {p.e["ana"]["equipo"], p.e["beto"]["equipo"]} == {"azul", "rojo"}  # equipos balanceados
    assert sum(1 for j in p.e.values() if j["bot"]) == 8
    p.salir("ana")
    p.salir("beto")
    assert p.e == {}


def test_movimiento_valido_se_acepta():
    p = partida()
    p.unir("ana", 3, 4, ahora=0.0)
    assert p.mover("ana", 3.5, 4.0, 0.0, ahora=0.05) is None
    assert p.e["ana"]["x"] == 3.5


def test_teletransporte_es_rechazado():
    p = partida()
    p.unir("ana", 3, 4, ahora=0.0)
    corr = p.mover("ana", 90, 90, 0.0, ahora=0.05)
    assert corr == {"x": 3.0, "y": 4.0}
    assert (p.e["ana"]["x"], p.e["ana"]["y"]) == (3.0, 4.0)


def test_no_se_puede_atravesar_una_pared():
    p = partida()
    p.unir("ana", 18.5, 25, ahora=0.0)            # junto a la pared (20, 20, 4, 14)
    assert p.mover("ana", 20.5, 25, 0.0, ahora=1.0) is not None


def test_posicion_inicial_dentro_de_una_pared_va_a_la_base():
    p = partida()
    j = p.unir("ana", 22, 25)
    assert (j["x"], j["y"]) in juego.APARICIONES[j["equipo"]]


def _duelo():
    """Ana (azul) en (40, 60) mirando a la derecha; un enemigo en (50, 60)."""
    p = partida()
    p.unir("ana", 3, 4)
    p.e = {"ana": p.e["ana"]}
    p.e["ana"].update(x=40.0, y=60.0, dir=0.0, equipo="azul")
    p.e["malo"] = {"id": "malo", "nombre": "Malo", "equipo": "rojo", "bot": True, "x": 50.0,
                   "y": 60.0, "dir": math.pi, "vida": 100, "bajas": 0, "muertes": 0}
    return p


def test_disparo_acierta_y_resta_vida():
    p = _duelo()
    assert p.disparar("ana", 1.0)
    assert p.e["malo"]["vida"] == 100 - juego.DANO
    ev = p.eventos[-1]
    assert ev["tipo"] == "disparo" and ev["impacto"] is True


def test_cadencia_limitada_por_el_servidor():
    p = _duelo()
    assert p.disparar("ana", 1.0)
    assert not p.disparar("ana", 1.1)              # demasiado pronto
    assert p.disparar("ana", 1.0 + juego.CADENCIA_S)


def test_pared_bloquea_el_disparo():
    p = _duelo()
    p.e["ana"].update(x=27.0, y=50.0)              # el obstáculo (30, 46, 6, 8) en medio
    p.e["malo"].update(x=40.0, y=50.0)
    p.disparar("ana", 1.0)
    assert p.e["malo"]["vida"] == 100
    assert p.eventos[-1]["impacto"] is False


def test_no_hay_fuego_amigo():
    p = _duelo()
    p.e["malo"]["equipo"] = "azul"
    p.disparar("ana", 1.0)
    assert p.e["malo"]["vida"] == 100


def test_baja_suma_al_marcador_y_reaparece():
    p = _duelo()
    t = 1.0
    for _ in range(4):
        p.disparar("ana", t)
        t += juego.CADENCIA_S
    assert p.e["malo"]["vida"] == 0
    assert p.marcador["azul"] == 1 and p.e["ana"]["bajas"] == 1 and p.e["malo"]["muertes"] == 1
    assert any(ev["tipo"] == "baja" for ev in p.eventos)
    p.paso(t + juego.RESPAWN_S + 0.1, 0.05)
    assert p.e["malo"]["vida"] == juego.VIDA
    # reapareció en su base (y en ese mismo tick el bot ya dio un paso)
    assert min(math.hypot(p.e["malo"]["x"] - x, p.e["malo"]["y"] - y)
               for x, y in juego.APARICIONES["rojo"]) < 1.0


def test_partida_termina_al_llegar_a_la_meta_y_se_reinicia():
    p = _duelo()
    p.marcador["azul"] = juego.META_BAJAS
    eventos = p.paso(10.0, 0.05)
    assert p.fin["ganador"] == "azul"
    assert any(ev["tipo"] == "fin" for ev in eventos)
    p.paso(10.0 + juego.PAUSA_FIN_S + 0.1, 0.05)
    assert p.fin is None and p.marcador == {"azul": 0, "rojo": 0}


def test_los_bots_combaten_solos():
    """60 s simulados con un humano quieto en su base: los bots se mueven,
    disparan y consiguen bajas."""
    p = partida()
    p.unir("ana", 3, 4)
    inicio = {k: (j["x"], j["y"]) for k, j in p.e.items()}
    disparos, t = 0, 0.0
    for _ in range(20 * 60):
        t += 0.05
        disparos += sum(1 for ev in p.paso(t, 0.05) if ev["tipo"] == "disparo")
    assert disparos > 0
    assert sum(p.marcador.values()) > 0
    movidos = sum(1 for k, j in p.e.items() if j["bot"] and k in inicio and
                  (j["x"], j["y"]) != inicio[k])
    assert movidos >= 5
    for j in p.e.values():                         # nadie terminó dentro de una pared
        assert not juego.choca(j["x"], j["y"])


def test_cliente_recibe_bienvenida_y_espectador_recibe_snapshots():
    async def prueba():
        server.estado.clear(); server.conexiones.clear(); server.espectadores.clear()
        server.motor.reiniciar(0.0)
        async with websockets.serve(server.jugador, "127.0.0.1", 0) as srv:
            puerto = srv.sockets[0].getsockname()[1]
            tick = asyncio.create_task(server.bucle())
            try:
                async with websockets.connect(f"ws://127.0.0.1:{puerto}") as ws, \
                        websockets.connect(f"ws://127.0.0.1:{puerto}/espectador") as esp:
                    assert "bienvenida" in json.loads(await esp.recv())
                    await ws.send(json.dumps({"id": "ana", "x": 3, "y": 4, "nombre": "Ana"}))
                    while "bienvenida" not in (b := json.loads(await ws.recv())):
                        pass
                    assert b["bienvenida"]["equipo"] in juego.EQUIPOS
                    assert b["bienvenida"]["mapa"]["obstaculos"]
                    while True:
                        d = json.loads(await esp.recv())
                        if "e" in d and "ana" in d["e"]:
                            break
                    assert len(d["e"]) == 10 and "m" in d and "r" in d
                    assert len(server.conexiones) == 1      # el espectador no ocupa lugar
            finally:
                tick.cancel()
    asyncio.run(asyncio.wait_for(prueba(), 10))
