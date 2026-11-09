"""Versión 2: clases, habilidades, proyectiles, railgun, escudos, prórroga y bots.
Las pruebas de la 1.2 (test_juego.py, test_server.py, test_integracion.py) no se
modificaron: la clase por defecto conserva el juego anterior."""
import math

import pytest

import juego
import server
from clases import CLASE_DEFECTO, CLASES
from geometria import choca


def duelo(clase_a="spectre", clase_b="spectre", ax=40.0, bx=50.0, y=60.0):
    """Dos naves frente a frente, sin bots: A (azul) mira a la derecha hacia B (rojo)."""
    p = juego.Partida(semilla=3)
    p.unir("a", 3, 4, clase=clase_a)
    p.e = {"a": p.e["a"]}
    p.e["a"].update(x=ax, y=y, dir=0.0, equipo="azul")
    p.e["b"] = p._ficha("b", "B", "rojo", True, clase_b)
    p.e["b"].update(x=bx, y=y, dir=math.pi)
    return p


def avanzar(p, desde, segundos, dt=0.05):
    t = desde
    eventos = []
    while t < desde + segundos - 1e-9:
        t += dt
        eventos += p.paso(t, dt)
    return t, eventos


def sin_bots(p):
    """Congela la IA para probar reglas sin interferencia."""
    p._pensar_bot = lambda *a, **k: None
    return p


# ---------------------------------------------------------------- clases
def test_clase_por_defecto_es_spectre_con_los_valores_de_la_1_2():
    p = juego.Partida(semilla=1)
    j = p.unir("ana", 3, 4)
    assert j["clase"] == CLASE_DEFECTO == "spectre"
    assert (juego.VIDA, juego.DANO, juego.CADENCIA_S, juego.VELOCIDAD) == (100, 25, 0.25, 12.0)


def test_cada_clase_tiene_stats_y_tres_habilidades():
    assert set(CLASES) == {"interceptor", "titan", "spectre", "destroyer", "phantom"}
    for c in CLASES.values():
        assert c["vida"] > 0 and c["velocidad"] > 0
        for h in ("q", "e", "s"):
            assert c[h]["cd"] > 0 and c[h]["nombre"]


def test_unirse_con_clase_y_clase_invalida_usa_la_de_defecto():
    p = juego.Partida(semilla=1)
    assert p.unir("ana", 3, 4, clase="titan")["vida"] == 200
    assert p.unir("beto", 3, 6, clase="pirata")["clase"] == CLASE_DEFECTO


def test_bots_cubren_las_cinco_clases_por_equipo():
    p = juego.Partida(semilla=1)
    p.unir("ana", 3, 4, clase="phantom")
    for eq in juego.EQUIPOS:
        assert sorted(j["clase"] for j in p.e.values() if j["equipo"] == eq) == sorted(CLASES)


def test_cambio_de_clase_se_aplica_al_reaparecer():
    p = sin_bots(juego.Partida(semilla=1))
    p.unir("ana", 3, 4)
    assert p.elegir_clase("ana", "titan")
    assert p.e["ana"]["clase"] == "spectre"
    p.e["ana"]["vida"] = 0
    p.respawn_en["ana"] = 1.0
    p.paso(1.1, 0.05)
    assert p.e["ana"]["clase"] == "titan" and p.e["ana"]["vida"] == 200


def test_velocidad_maxima_depende_de_la_clase():
    p = juego.Partida(semilla=1)
    p.unir("ti", 3, 4, clase="titan", ahora=0.0)
    p.unir("it", 3, 8, clase="interceptor", ahora=0.0)
    # 1.6 unidades en 0.05 s = 32 u/s: dentro de la tolerancia del Interceptor (15*2),
    # fuera de la del Titan (9*2)
    assert p.mover("it", 3 + 1.6, 8, 0.0, 0.05) is None
    assert p.mover("ti", 3 + 1.6, 4, 0.0, 0.05) is not None


# ---------------------------------------------------------------- validación (server.py)
def test_validar_acepta_campos_opcionales_v2():
    d = server.validar({"id": "ana", "x": 1, "y": 1, "clase": "phantom", "hab": "q",
                        "ax": 50, "ay": 120, "mdx": 3, "mdy": -0.5}, None)
    assert d["clase"] == "phantom" and d["hab"] == "q"
    assert d["ay"] == 100.0 and d["mdx"] == 1.0           # se recortan a su rango


@pytest.mark.parametrize("extra", [{"clase": "pirata"}, {"hab": "x"}, {"ax": 5},
                                   {"ax": "a", "ay": 1}, {"mdx": float("nan"), "mdy": 0}])
def test_validar_rechaza_campos_v2_invalidos(extra):
    assert server.validar({"id": "ana", "x": 1, "y": 1, **extra}, None) is None


def test_mensaje_de_la_1_2_sigue_siendo_valido():
    assert server.validar({"id": "ana", "x": 10, "y": 20.5, "dispara": True}, None) == \
        {"id": "ana", "x": 10.0, "y": 20.5, "dispara": True}


# ---------------------------------------------------------------- proyectiles
def test_proyectil_viaja_y_golpea_varios_ticks_despues():
    p = sin_bots(duelo("interceptor"))
    assert p.disparar("a", 1.0)
    assert p.e["b"]["vida"] == 100                         # el daño no es instantáneo
    assert any(ev["tipo"] == "proy" for ev in p.eventos)
    vida0 = p.e["b"]["vida"]
    _, eventos = avanzar(p, 1.0, 0.5)
    assert p.e["b"]["vida"] == vida0 - CLASES["interceptor"]["arma"]["dano"]
    assert any(ev["tipo"] == "proy_fin" and ev["impacto"] for ev in eventos)
    assert not p.proy


def test_proyectil_no_atraviesa_paredes():
    p = sin_bots(duelo("interceptor", ax=27.0, bx=40.0, y=50.0))   # bloque (30, 46, 6, 8) en medio
    p.disparar("a", 1.0)
    _, eventos = avanzar(p, 1.0, 1.0)
    assert p.e["b"]["vida"] == 100
    fin = [ev for ev in eventos if ev["tipo"] == "proy_fin"]
    assert fin and not fin[0]["impacto"] and fin[0]["x"] <= 30.01


def test_proyectil_se_agota_al_llegar_a_su_alcance():
    p = sin_bots(duelo("titan", bx=95.0))
    p.e["a"].update(x=50.0, y=95.0, dir=-math.pi / 2)       # hacia arriba
    p.disparar("a", 1.0)
    avanzar(p, 1.0, 3.0)
    assert not p.proy


def test_limite_de_proyectiles():
    p = sin_bots(duelo("interceptor"))
    for k in range(300):
        p._lanzar("a", "azul", 50, 50, 0, -1, 1, 1.0, 50, 0.2, "canon")
    assert len(p.proy) == 150


def test_explosion_del_destroyer_dana_en_area_pero_no_tras_pared():
    p = sin_bots(duelo("destroyer"))
    p.e["c"] = p._ficha("c", "C", "rojo", True, "spectre")
    p.e["c"].update(x=50.0, y=62.0)                        # junto a B: lo alcanza la explosión
    p.disparar("a", 1.0)
    avanzar(p, 1.0, 0.5)
    assert p.e["b"]["vida"] == 100 - 24
    assert p.e["c"]["vida"] == 100 - 10


# ---------------------------------------------------------------- railgun
def test_railgun_atraviesa_enemigos_alineados():
    p = sin_bots(duelo("phantom"))
    p.e["c"] = p._ficha("c", "C", "rojo", True, "spectre")
    p.e["c"].update(x=56.0, y=60.0)
    assert p.disparar("a", 1.0)
    assert p.e["b"]["vida"] == 100 - 60 and p.e["c"]["vida"] == 100 - 60
    ev = p.eventos[-1]
    assert ev["arma"] == "railgun" and ev["impacto"]


def test_railgun_no_atraviesa_paredes():
    p = sin_bots(duelo("phantom", ax=27.0, bx=40.0, y=50.0))
    p.disparar("a", 1.0)
    assert p.e["b"]["vida"] == 100 and p.eventos[-1]["x2"] <= 30.01


def test_railgun_respeta_su_cadencia():
    p = sin_bots(duelo("phantom"))
    assert p.disparar("a", 1.0)
    assert not p.disparar("a", 2.0)                        # 1.4 s entre disparos
    assert p.disparar("a", 2.5)


def test_disparo_de_precision_cargado_hace_mas_dano_y_tiene_limite():
    p = sin_bots(duelo("phantom", clase_b="titan"))
    assert p.habilidad("a", "q", 1.0)
    p.paso(2.0, 0.05)
    assert p.e["a"]["est"]["carga"] == 0.5
    p.disparar("a", 5.0)                                   # 4 s: la carga topa en 1.0
    assert p.e["b"]["vida"] == 200 - 60 - 70
    assert p.e["a"]["cd"] and p.cds["a"]["q"] == 5.0 + CLASES["phantom"]["q"]["cd"]


# ---------------------------------------------------------------- habilidades y enfriamientos
def test_habilidad_respeta_enfriamiento():
    p = sin_bots(duelo("titan"))
    assert p.habilidad("a", "q", 1.0)
    assert p.habilidad("a", "q", 2.0) is None
    assert p.habilidad("a", "q", 1.0 + CLASES["titan"]["q"]["cd"])


def test_nave_destruida_no_usa_habilidades():
    p = sin_bots(duelo("titan"))
    p.e["a"]["vida"] = 0
    assert p.habilidad("a", "q", 1.0) is None


def test_escudo_titanico_absorbe_y_vence():
    p = sin_bots(duelo(clase_a="spectre", clase_b="titan"))
    p.habilidad("b", "q", 1.0)
    assert p.e["b"]["escudo"] == 100
    p.disparar("a", 1.0)
    assert (p.e["b"]["escudo"], p.e["b"]["vida"]) == (75, 200)
    p.paso(1.0 + 6.1, 0.05)
    assert p.e["b"]["escudo"] == 0


def test_fortificacion_reduce_el_dano():
    p = sin_bots(duelo(clase_a="spectre", clase_b="titan"))
    p.habilidad("b", "e", 1.0)
    p.disparar("a", 1.0)
    assert p.e["b"]["vida"] == 200 - round(25 * 0.5)


def test_pulso_de_reparacion_cura_aliados_cercanos_sin_pasar_del_maximo():
    p = sin_bots(duelo("spectre"))
    p.e["d"] = p._ficha("d", "D", "azul", True, "titan")
    p.e["d"].update(x=44.0, y=60.0, vida=190)
    p.e["a"]["vida"] = 30
    p.habilidad("a", "q", 1.0)
    assert p.e["a"]["vida"] == 70 and p.e["d"]["vida"] == 200
    assert p.e["b"]["vida"] == 100                         # al enemigo no


def test_campo_de_apoyo_reduce_dano_y_repara():
    p = sin_bots(duelo(clase_a="spectre", clase_b="spectre"))
    p.habilidad("b", "e", 1.0)
    p.disparar("a", 1.0)
    assert p.e["b"]["vida"] == 100 - round(25 * 0.7)
    avanzar(p, 1.0, 2.0)
    assert p.e["b"]["vida"] > 100 - round(25 * 0.7)


def test_bombardeo_cae_despues_del_retardo_en_la_zona_apuntada():
    p = sin_bots(duelo("destroyer"))
    info = p.habilidad("a", "q", 1.0, ax=50.0, ay=60.0)
    assert info and info["ax"] == 50.0
    assert p.e["b"]["vida"] == 100
    avanzar(p, 1.0, 1.2)
    assert p.e["b"]["vida"] == 100 - 55


def test_bombardeo_aliado_no_cuenta_como_campo_de_apoyo():
    """Regresión: una nave dentro de un bombardeo de su propio equipo recibía
    daño y el tick fallaba (KeyError 'reduccion') al tratarlo como campo."""
    p = sin_bots(duelo("spectre", "destroyer"))
    p.habilidad("b", "q", 1.0, ax=50.0, ay=60.0)   # B marca un bombardeo sobre sí mismo
    p.disparar("a", 1.0)
    assert p.e["b"]["vida"] == CLASES["destroyer"]["vida"] - 25


def test_bombardeo_se_limita_a_su_alcance():
    p = sin_bots(duelo("destroyer"))
    info = p.habilidad("a", "q", 1.0, ax=99.0, ay=60.0)
    assert math.hypot(info["ax"] - 40, info["ay"] - 60) <= CLASES["destroyer"]["q"]["alcance"] + 1e-6


def test_misiles_tacticos_buscan_enemigos_visibles():
    p = sin_bots(duelo("destroyer"))
    p.habilidad("a", "e", 1.0)
    assert sum(1 for ev in p.eventos if ev["tipo"] == "proy" and ev["arma"] == "misil") == 4
    avanzar(p, 1.0, 1.0)
    assert p.e["b"]["vida"] < 100


def test_camuflaje_impide_disparar_y_se_revela_al_recibir_dano():
    p = sin_bots(duelo("phantom", clase_b="spectre"))
    p.habilidad("a", "e", 1.0)
    assert not p.disparar("a", 1.0)
    p.e["b"]["dir"] = math.pi
    p.disparar("b", 1.0)
    assert not p._activo("a", "camo", 1.0)
    assert any(ev["tipo"] == "revelado" for ev in p.eventos)


def test_camuflaje_tiene_duracion_limitada():
    p = sin_bots(duelo("phantom"))
    p.habilidad("a", "e", 1.0)
    assert p._activo("a", "camo", 6.9)
    assert not p._activo("a", "camo", 7.1)


def test_impulso_del_interceptor_sube_la_velocidad_permitida():
    p = sin_bots(duelo("interceptor"))
    p.ultimo_mov["a"] = 1.0
    assert p.mover("a", 40 + 2.3, 60, 0.0, 1.05) is not None   # 46 u/s: demasiado rápido
    p.habilidad("a", "q", 1.0)
    assert p.mover("a", 40 + 2.3, 60, 0.0, 1.05) is None       # con impulso (15*1.6*2) sí


def test_desplazamiento_mueve_la_nave_y_no_atraviesa_paredes():
    p = sin_bots(duelo("spectre", ax=27.0, bx=80.0, y=50.0))
    info = p.habilidad("a", "s", 1.0, mdx=1.0, mdy=0.0)
    assert info["pos"]["x"] <= 29.0 and not choca(p.e["a"]["x"], p.e["a"]["y"])
    p2 = sin_bots(duelo("spectre"))
    info = p2.habilidad("a", "s", 1.0, mdx=0.0, mdy=-1.0)
    assert info["pos"]["y"] == pytest.approx(52.0, abs=0.3)


def test_tras_desplazarse_los_mensajes_viejos_no_generan_correccion():
    p = sin_bots(duelo("spectre"))
    p.habilidad("a", "s", 1.0, mdx=0.0, mdy=-1.0)
    assert p.mover("a", 40.0, 60.0, 0.0, 1.05) is None        # posición vieja, en vuelo
    assert p.e["a"]["y"] < 53                                   # pero no se aceptó


def test_evasion_da_invulnerabilidad_breve():
    p = sin_bots(duelo("interceptor", clase_b="spectre"))
    p.habilidad("a", "e", 1.0)
    p.e["b"]["dir"] = math.atan2(p.e["a"]["y"] - 60, p.e["a"]["x"] - 50)
    vida = p.e["a"]["vida"]
    p.disparar("b", 1.1)
    assert p.e["a"]["vida"] == vida


# ---------------------------------------------------------------- bajas, asistencias, fin
def test_asistencia_para_quien_dano_antes_de_la_baja():
    p = sin_bots(duelo("spectre"))
    p.e["c"] = p._ficha("c", "C", "azul", True, "spectre")
    p.e["c"].update(x=40.0, y=58.0, dir=math.atan2(2, 10))
    p.disparar("c", 1.0)
    t = 2.0
    while p.e["b"]["vida"] > 0:
        p.disparar("a", t)
        t += 0.25
    assert p.e["a"]["bajas"] == 1 and p.e["c"]["asist"] == 1
    baja = [ev for ev in p.eventos if ev["tipo"] == "baja"][0]
    assert baja["asist"] == ["C"]


def test_empate_al_acabar_el_tiempo_va_a_prorroga_y_la_siguiente_baja_gana():
    p = sin_bots(juego.Partida(semilla=2))
    p.unir("ana", 3, 4, ahora=0.0)
    p.marcador = {"azul": 3, "rojo": 3}
    ev = p.paso(juego.DURACION_S + 0.1, 0.05)
    assert p.prorroga is not None and p.fin is None
    assert any(e["tipo"] == "prorroga" for e in ev)
    assert p.tiempo_restante(juego.DURACION_S + 10) == pytest.approx(juego.PRORROGA_S - 9.9, abs=0.01)
    p.marcador["rojo"] += 1
    p.paso(juego.DURACION_S + 20, 0.05)
    assert p.fin["ganador"] == "rojo" and p.fin["prorroga"]


def test_prorroga_sin_bajas_termina_en_empate():
    p = sin_bots(juego.Partida(semilla=2))
    p.unir("ana", 3, 4, ahora=0.0)
    p.paso(juego.DURACION_S + 0.1, 0.05)
    p.paso(juego.DURACION_S + juego.PRORROGA_S + 0.2, 0.05)
    assert p.fin["ganador"] == "empate"


def test_tiempo_agotado_sin_empate_gana_el_que_va_arriba():
    p = sin_bots(juego.Partida(semilla=2))
    p.unir("ana", 3, 4, ahora=0.0)
    p.marcador = {"azul": 5, "rojo": 2}
    p.paso(juego.DURACION_S + 0.1, 0.05)
    assert p.fin["ganador"] == "azul" and not p.fin["prorroga"]


# ---------------------------------------------------------------- bots
def test_bots_no_ven_a_traves_de_paredes_ni_al_camuflado():
    p = sin_bots(duelo("phantom", clase_b="titan", ax=27.0, bx=40.0, y=50.0))
    assert p._enemigos_visibles(p.e["b"], "titan", 1.0) == []          # pared en medio
    q = sin_bots(duelo("phantom", clase_b="titan"))
    assert q._enemigos_visibles(q.e["b"], "titan", 1.0)
    q.habilidad("a", "e", 1.0)
    assert q._enemigos_visibles(q.e["b"], "titan", 1.0) == []          # camuflado a 10 u


def test_estados_de_los_bots_por_clase():
    p = duelo("spectre", clase_b="phantom", bx=50.0)
    p.e["a"]["vida"] = 100
    p._pensar_bot("b", p.e["b"], 1.0, 0.05)
    assert p.mente["b"]["estado"] == "RETREAT"                         # Phantom con enemigo a 10 u
    q = duelo("spectre", clase_b="titan", bx=80.0)
    q.e["c"] = q._ficha("c", "C", "rojo", True, "spectre")
    q.e["c"].update(x=85.0, y=20.0)
    q.e["a"].update(x=5.0, y=95.0)                                     # sin visión
    q._pensar_bot("b", q.e["b"], 1.0, 0.05)
    q._pensar_bot("c", q.e["c"], 1.0, 0.05)
    assert q.mente["b"]["estado"] == "DEFEND" and q.mente["c"]["estado"] == "SUPPORT"
    q.e["b"]["vida"] = 0
    q._pensar_bot("b", q.e["b"], 1.0, 0.05)
    assert q.mente["b"]["estado"] == "RESPAWN"


def test_partida_de_bots_usa_todas_las_clases_y_habilidades():
    """2 minutos simulados: cada clase dispara y usa habilidades; nadie atraviesa paredes."""
    p = juego.Partida(semilla=7)
    p.unir("ana", 3, 4)
    p.e["ana"]["vida"] = 0                     # el humano no participa
    p.respawn_en["ana"] = 1e9
    usos = set()
    t = 0.0
    for _ in range(20 * 120):
        t += 0.05
        p.paso(t, 0.05)
        for j in p.e.values():
            assert j["vida"] <= 0 or not choca(j["x"], j["y"])
        usos.update(p.usos_habilidad)
        p.usos_habilidad.clear()
    clases_con_habilidad = {c for c, _ in usos}
    assert clases_con_habilidad >= {"interceptor", "titan", "destroyer", "phantom", "spectre"}
    assert sum(p.marcador.values()) > 5
