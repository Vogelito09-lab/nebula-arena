"""Reglas de Nebula Arena, del lado del servidor (autoritativo).

El cliente solo propone su posición, su ángulo de apuntado, si dispara, qué
habilidad quiere usar y su clase. El servidor decide todo lo que importa:
  - si el movimiento es posible (velocidad máxima de la clase y paredes),
  - disparos, proyectiles, explosiones, daño, escudos, curación y bajas,
  - habilidades y sus enfriamientos,
  - el marcador, el tiempo, la prórroga y el fin de la partida,
  - los bots que completan los equipos 5 vs 5.

Los bots son por REGLAS (máquina de estados, ver bots.py). No usan aprendizaje
por refuerzo.

No depende de la red: server.py llama a estas funciones en cada tick, lo que
permite probar las reglas sin abrir sockets.

Módulos:
  estacion.py     mapa Orbital Station
  geometria.py    colisiones, rayos y línea de visión
  clases.py       las cinco clases (estadísticas, armas y habilidades)
  combate.py      armas, proyectiles, daño, bajas y asistencias
  habilidades.py  Q, E y Espacio
  nav.py          A* para los bots
  bots.py         IA de los bots
"""
import math
import random

import clases
from bots import Bots
from clases import CLASE_DEFECTO, CLASES, ORDEN_BOTS
from combate import Combate
from estacion import APARICIONES, ARENA, OBSTACULOS, TIPOS
from geometria import (ALCANCE, RADIO, _rayo_caja, _rayo_circulo, choca,  # noqa: F401
                       distancia_a_pared, hay_vision)
from habilidades import Habilidades

# Valores de la versión 1.2: son los de la clase por defecto (Spectre).
VELOCIDAD = CLASES[CLASE_DEFECTO]["velocidad"]      # 12 unidades por segundo
VIDA = CLASES[CLASE_DEFECTO]["vida"]                # 100
DANO = CLASES[CLASE_DEFECTO]["arma"]["dano"]        # 25
CADENCIA_S = CLASES[CLASE_DEFECTO]["arma"]["cadencia"]
TOLERANCIA_VEL = 2.0              # margen por jitter de red al validar el movimiento
RESPAWN_S = 3.0
DURACION_S = 300.0                # 5 minutos
PRORROGA_S = 60.0                 # empate al acabar el tiempo: gana la siguiente baja
META_BAJAS = 50                   # el primer equipo en llegar gana
PAUSA_FIN_S = 10.0                # resultados en pantalla antes de reiniciar
POR_EQUIPO = 5
EQUIPOS = ("azul", "rojo")
NOMBRES_BOT = ["Orion", "Vega", "Lyra", "Draco", "Nova", "Atlas", "Rigel", "Sirius", "Cygnus", "Altair"]


def mapa():
    """Lo que el cliente necesita para dibujar la arena."""
    return {"tamano": ARENA, "obstaculos": OBSTACULOS, "tipos": TIPOS,
            "apariciones": APARICIONES, "meta_bajas": META_BAJAS, "duracion_s": DURACION_S}


class Partida(Combate, Habilidades, Bots):
    RESPAWN_S = RESPAWN_S

    def __init__(self, entidades=None, semilla=None):
        # entidades es el mismo dict que server.estado: lo que viaja en el snapshot
        self.e = entidades if entidades is not None else {}
        self.rng = random.Random(semilla)
        self.usos_habilidad = []          # (clase, habilidad) para las métricas
        self.exhibicion = False           # partida solo de bots para espectadores
        self.reiniciar(0.0)

    def reiniciar(self, ahora):
        self.marcador = {"azul": 0, "rojo": 0}
        self.inicio = ahora
        self.prorroga = None              # momento en que empezó la prórroga
        self.fin = None                   # dict con resultados cuando termina
        self.eventos = []
        self.ultimo_disparo = {}
        self.respawn_en = {}
        self.ultimo_mov = {}
        self.mente = {}                   # estado interno de cada bot
        self.proy, self.sig_proy = {}, 1
        self.zonas = []                   # campos de apoyo y bombardeos en curso
        self.efectos = {}                 # jid -> {efecto: hasta}
        self.cds = {}                     # jid -> {q/e/s: listo_en}
        self.carga = {}                   # Phantom cargando el railgun: jid -> inicio
        self.gracia = {}                  # tras un desplazamiento
        self.dano_reciente = {}           # víctima -> {atacante: t}
        self.cura_acum = {}
        self.vel_est, self.pos_previa = {}, {}
        self.rutas_tick = 0
        for jid, j in list(self.e.items()):
            if j.get("bot"):
                del self.e[jid]
            else:
                self._aparecer(jid)
                j.update(bajas=0, muertes=0, asist=0)

    def _cfg(self, j):
        return clases.clase(j.get("clase"))

    # ---- altas y bajas
    def humanos(self, equipo=None):
        return [k for k, j in self.e.items() if not j.get("bot") and
                (equipo is None or j.get("equipo") == equipo)]

    def _equipo_libre(self):
        n = {eq: len(self.humanos(eq)) for eq in EQUIPOS}
        return min(EQUIPOS, key=lambda eq: (n[eq], EQUIPOS.index(eq)))

    def _ficha(self, jid, nombre, equipo, bot, clase):
        clase = clase if clase in CLASES else CLASE_DEFECTO
        vida = CLASES[clase]["vida"]
        return {"id": jid, "nombre": nombre, "equipo": equipo, "bot": bot, "clase": clase,
                "x": 0.0, "y": 0.0, "dir": 0.0, "vida": vida, "vmax": vida, "escudo": 0,
                "bajas": 0, "muertes": 0, "asist": 0, "dispara": False,
                "est": {}, "cd": {"q": 0.0, "e": 0.0, "s": 0.0}}

    def unir(self, jid, x, y, nombre=None, ahora=0.0, clase=None, equipo=None):
        """Alta de un humano. La primera posición se acepta si es válida;
        si no, aparece en la base de su equipo. El primer humano en llegar a
        una arena vacía arranca la partida (el reloj empieza aquí).
        `equipo` es la preferencia del jugador: se respeta mientras ese equipo
        tenga lugar para humanos; si no, se asigna el equipo con menos humanos."""
        if not self.humanos():
            self.exhibicion = False           # la exhibición de bots termina aquí
            self.reiniciar(ahora)
        if equipo not in EQUIPOS or len(self.humanos(equipo)) >= POR_EQUIPO:
            equipo = self._equipo_libre()
        self.e[jid] = self._ficha(jid, nombre or jid, equipo, False, clase)
        self.e[jid].update(x=float(x), y=float(y))
        if choca(x, y):
            self._aparecer(jid)
        self.ultimo_mov[jid] = ahora
        self.completar_con_bots()
        return self.e[jid]

    def elegir_clase(self, jid, clase):
        """Cambio de clase: inmediato si la nave está destruida; si no, al reaparecer."""
        j = self.e.get(jid)
        if j is None or clase not in CLASES:
            return False
        if j["vida"] <= 0:
            j["clase"] = clase
            j.pop("clase_sig", None)
        elif clase != j.get("clase"):
            j["clase_sig"] = clase
        return True

    def salir(self, jid):
        self.e.pop(jid, None)
        for d in (self.ultimo_disparo, self.respawn_en, self.ultimo_mov, self.mente,
                  self.efectos, self.cds, self.carga, self.gracia, self.dano_reciente,
                  self.cura_acum, self.vel_est, self.pos_previa):
            d.pop(jid, None)
        self.completar_con_bots()

    def iniciar_exhibicion(self, ahora):
        """Arena sin humanos pero con espectadores: una partida solo de bots
        para que haya algo que ver. Se descarta en cuanto entra un humano."""
        if self.humanos() or self.exhibicion:
            return False
        self.exhibicion = True
        self.reiniciar(ahora)
        self.completar_con_bots()
        return True

    def terminar_exhibicion(self):
        """Ya no hay espectadores: se quitan los bots y la arena queda vacía."""
        if not self.exhibicion:
            return
        self.exhibicion = False
        self.completar_con_bots()

    def completar_con_bots(self):
        """Rellena cada equipo hasta 5 con bots, solo si hay al menos un humano.
        Cada bot toma una clase que su equipo todavía no tenga."""
        hay_humanos = bool(self.humanos()) or self.exhibicion
        for eq in EQUIPOS:
            bots = [k for k, j in self.e.items() if j.get("bot") and j["equipo"] == eq]
            faltan = (POR_EQUIPO - len(self.humanos(eq))) if hay_humanos else 0
            while len(bots) > max(faltan, 0):
                self.e.pop(bots.pop(), None)
            usados = {j["nombre"].removesuffix(" [BOT]") for j in self.e.values()}
            libres = [n for n in NOMBRES_BOT if n not in usados]
            while len(bots) < faltan:
                en_equipo = [j.get("clase") for j in self.e.values() if j["equipo"] == eq]
                clase = next((c for c in ORDEN_BOTS if c not in en_equipo),
                             ORDEN_BOTS[len(bots) % len(ORDEN_BOTS)])
                bid = f"bot-{eq}-{self.rng.randrange(10**6):06d}"
                self.e[bid] = self._ficha(bid, (libres.pop(0) if libres else bid) + " [BOT]",
                                          eq, True, clase)
                self._aparecer(bid)
                bots.append(bid)

    def _aparecer(self, jid):
        j = self.e[jid]
        if j.get("clase_sig"):
            j["clase"] = j.pop("clase_sig")
        opciones = APARICIONES[j.get("equipo", "azul")]
        libres = [p for p in opciones if not any(
            o is not j and o.get("vida", 0) > 0 and math.hypot(o["x"] - p[0], o["y"] - p[1]) < 2.5
            for o in self.e.values())]
        x, y = self.rng.choice(libres or opciones)
        vida = self._cfg(j)["vida"]
        j.update(x=float(x), y=float(y), vida=vida, dir=0.0 if j.get("equipo") == "azul" else math.pi)
        if "vmax" in j:
            j.update(vmax=vida, escudo=0)
        self.respawn_en.pop(jid, None)
        self.efectos.pop(jid, None)
        self.carga.pop(jid, None)
        self.gracia.pop(jid, None)
        self.pos_previa.pop(jid, None)

    # ---- entradas de humanos
    def mover(self, jid, x, y, direc, ahora):
        """Valida el movimiento propuesto. Devuelve None si se acepta o la
        posición correcta si el servidor la rechaza (el cliente debe corregir)."""
        j = self.e.get(jid)
        if j is None or j["vida"] <= 0 or self.fin:
            return None
        if direc is not None:
            j["dir"] = direc
        dt = max(ahora - self.ultimo_mov.get(jid, ahora), 0.05)
        paso = math.hypot(x - j["x"], y - j["y"])
        limite = self._cfg(j)["velocidad"] * self._mult_vel(jid, ahora) * TOLERANCIA_VEL * dt + 0.5
        if paso > limite or choca(x, y):
            if self.gracia.get(jid, 0.0) > ahora:
                return None                   # mensaje viejo, de antes del desplazamiento
            return {"x": j["x"], "y": j["y"]}
        j["x"], j["y"] = float(x), float(y)
        self.ultimo_mov[jid] = ahora
        return None

    # ---- tick
    def paso(self, ahora, dt):
        """Avanza la simulación un tick. Devuelve y vacía los eventos del tick."""
        if self.fin:
            if ahora - self.fin["t"] >= PAUSA_FIN_S:
                self.reiniciar(ahora)
                self.completar_con_bots()
            eventos, self.eventos = self.eventos, []
            return eventos
        for jid, t in list(self.respawn_en.items()):
            if ahora >= t and jid in self.e:
                self._aparecer(jid)
        self._estimar_velocidades(dt)
        self._actualizar_estados(ahora, dt)
        self.rutas_tick = 0
        for jid, j in list(self.e.items()):
            if j.get("bot"):
                self._pensar_bot(jid, j, ahora, dt)
        self._mover_proyectiles(ahora, dt)
        self._revisar_fin(ahora)
        eventos, self.eventos = self.eventos, []
        return eventos

    def _estimar_velocidades(self, dt):
        for jid, j in self.e.items():
            prev = self.pos_previa.get(jid)
            if prev and dt > 0:
                vx, vy = (j["x"] - prev[0]) / dt, (j["y"] - prev[1]) / dt
                self.vel_est[jid] = (vx, vy) if math.hypot(vx, vy) < 40 else (0.0, 0.0)
            self.pos_previa[jid] = (j["x"], j["y"])

    def _revisar_fin(self, ahora):
        ganador = next((eq for eq in EQUIPOS if self.marcador[eq] >= META_BAJAS), None)
        if not ganador and (self.humanos() or self.exhibicion) and ahora - self.inicio >= DURACION_S:
            a, r = self.marcador["azul"], self.marcador["rojo"]
            if a != r:                        # también cubre la primera baja de la prórroga
                ganador = "azul" if a > r else "rojo"
            elif self.prorroga is None:
                self.prorroga = ahora
                self.eventos.append({"tipo": "prorroga", "dur": PRORROGA_S})
            elif ahora - self.prorroga >= PRORROGA_S:
                ganador = "empate"
        if ganador:
            self.fin = {"t": ahora, "ganador": ganador, "marcador": dict(self.marcador),
                        "prorroga": self.prorroga is not None,
                        "jugadores": sorted(
                            ({"nombre": j["nombre"], "equipo": j["equipo"], "bot": j["bot"],
                              "clase": j.get("clase", CLASE_DEFECTO),
                              "bajas": j["bajas"], "muertes": j["muertes"],
                              "asist": j.get("asist", 0)} for j in self.e.values()),
                            key=lambda f: (-f["bajas"], f["muertes"]))}
            self.proy.clear()
            self.zonas = []
            self.eventos.append({"tipo": "fin", **{k: v for k, v in self.fin.items() if k != "t"}})

    def tiempo_restante(self, ahora):
        if self.fin:
            return 0.0
        if not self.humanos() and not self.exhibicion:   # arena vacía: no ha empezado
            return float(DURACION_S)
        if self.prorroga is not None:
            return max(0.0, PRORROGA_S - (ahora - self.prorroga))
        return max(0.0, DURACION_S - (ahora - self.inicio))

    def _punto_libre(self):
        while True:
            x, y = self.rng.uniform(5, 95), self.rng.uniform(5, 95)
            if not choca(x, y, RADIO * 2):
                return (x, y)
