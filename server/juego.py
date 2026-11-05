"""Reglas de Nebula Arena, del lado del servidor (autoritativo).

El cliente solo propone su posición, su ángulo de apuntado y si dispara. El
servidor decide todo lo que importa:
  - si el movimiento es posible (velocidad máxima y paredes),
  - si un disparo acierta (raycast contra paredes y jugadores), el daño y las bajas,
  - el marcador, el tiempo y el fin de la partida,
  - los bots que completan los equipos 5 vs 5.

Los bots son por REGLAS (máquina de estados: patrullar, combatir, retirarse).
No usan aprendizaje por refuerzo.

No depende de la red: server.py llama a estas funciones en cada tick, lo que
permite probar las reglas sin abrir sockets.
"""
import math
import random

ARENA = 100.0
RADIO = 1.0                       # radio de colisión de un jugador
VELOCIDAD = 12.0                  # unidades por segundo
TOLERANCIA_VEL = 2.0              # margen por jitter de red al validar el movimiento
VIDA = 100
DANO = 25
CADENCIA_S = 0.25                 # tiempo mínimo entre disparos
ALCANCE = 60.0
RESPAWN_S = 3.0
DURACION_S = 300.0                # 5 minutos
META_BAJAS = 25                   # el primer equipo en llegar gana
PAUSA_FIN_S = 10.0                # resultados en pantalla antes de reiniciar
POR_EQUIPO = 5
EQUIPOS = ("azul", "rojo")

# Obstáculos (x, y, ancho, alto), simétricos respecto a x = 50.
OBSTACULOS = [
    (20, 20, 4, 14), (20, 66, 4, 14), (76, 20, 4, 14), (76, 66, 4, 14),
    (30, 46, 6, 8), (64, 46, 6, 8),
    (44, 14, 12, 4), (44, 82, 12, 4),
    (10, 46, 3, 8), (87, 46, 3, 8),
    (38, 28, 4, 4), (58, 28, 4, 4), (38, 68, 4, 4), (58, 68, 4, 4),
]
APARICIONES = {
    "azul": [(5, 40), (5, 45), (5, 50), (5, 55), (5, 60)],
    "rojo": [(95, 40), (95, 45), (95, 50), (95, 55), (95, 60)],
}
NOMBRES_BOT = ["Orion", "Vega", "Lyra", "Draco", "Nova", "Atlas", "Rigel", "Sirius", "Cygnus", "Altair"]


def mapa():
    """Lo que el cliente necesita para dibujar la arena."""
    return {"tamano": ARENA, "obstaculos": OBSTACULOS, "apariciones": APARICIONES,
            "meta_bajas": META_BAJAS, "duracion_s": DURACION_S}


# ---------------------------------------------------------------- geometría
def choca(x, y, r=RADIO):
    """True si un círculo en (x, y) se sale de la arena o toca un obstáculo."""
    if x < r or y < r or x > ARENA - r or y > ARENA - r:
        return True
    for ox, oy, w, h in OBSTACULOS:
        cx, cy = min(max(x, ox), ox + w), min(max(y, oy), oy + h)
        if (x - cx) ** 2 + (y - cy) ** 2 < r * r:
            return True
    return False


def _rayo_caja(x, y, dx, dy, caja):
    """Distancia a la que el rayo entra en la caja, o None."""
    ox, oy, w, h = caja
    tmin, tmax = 0.0, math.inf
    for p, d, lo, hi in ((x, dx, ox, ox + w), (y, dy, oy, oy + h)):
        if abs(d) < 1e-9:
            if p < lo or p > hi:
                return None
        else:
            t1, t2 = (lo - p) / d, (hi - p) / d
            tmin, tmax = max(tmin, min(t1, t2)), min(tmax, max(t1, t2))
            if tmin > tmax:
                return None
    return tmin


def distancia_a_pared(x, y, dx, dy, alcance=ALCANCE):
    d = alcance
    for caja in OBSTACULOS:
        t = _rayo_caja(x, y, dx, dy, caja)
        if t is not None and t < d:
            d = t
    return d


def _rayo_circulo(x, y, dx, dy, cx, cy, r=RADIO):
    fx, fy = x - cx, y - cy
    b = fx * dx + fy * dy
    c = fx * fx + fy * fy - r * r
    disc = b * b - c
    if disc < 0:
        return None
    t = -b - math.sqrt(disc)
    return t if t >= 0 else None


def hay_vision(a, b):
    dx, dy = b["x"] - a["x"], b["y"] - a["y"]
    dist = math.hypot(dx, dy)
    if dist < 1e-6:
        return True
    return distancia_a_pared(a["x"], a["y"], dx / dist, dy / dist, dist) >= dist


# ---------------------------------------------------------------- partida
class Partida:
    def __init__(self, entidades=None, semilla=None):
        # entidades es el mismo dict que server.estado: lo que viaja en el snapshot
        self.e = entidades if entidades is not None else {}
        self.rng = random.Random(semilla)
        self.reiniciar(0.0)

    def reiniciar(self, ahora):
        self.marcador = {"azul": 0, "rojo": 0}
        self.inicio = ahora
        self.fin = None                     # dict con resultados cuando termina
        self.eventos = []
        self.ultimo_disparo = {}
        self.respawn_en = {}
        self.ultimo_mov = {}
        self.mente = {}                     # estado interno de cada bot
        for jid, j in list(self.e.items()):
            if j.get("bot"):
                del self.e[jid]
            else:
                self._aparecer(jid)
                j.update(bajas=0, muertes=0)

    # ---- altas y bajas
    def humanos(self, equipo=None):
        return [k for k, j in self.e.items() if not j.get("bot") and
                (equipo is None or j.get("equipo") == equipo)]

    def _equipo_libre(self):
        n = {eq: len(self.humanos(eq)) for eq in EQUIPOS}
        return min(EQUIPOS, key=lambda eq: (n[eq], EQUIPOS.index(eq)))

    def unir(self, jid, x, y, nombre=None, ahora=0.0):
        """Alta de un humano. La primera posición se acepta si es válida;
        si no, aparece en la base de su equipo. El primer humano en llegar a
        una arena vacía arranca la partida (el reloj empieza aquí)."""
        if not self.humanos():
            self.reiniciar(ahora)
        equipo = self._equipo_libre()
        self.e[jid] = {"id": jid, "nombre": nombre or jid, "equipo": equipo, "bot": False,
                       "x": float(x), "y": float(y), "dir": 0.0, "vida": VIDA,
                       "bajas": 0, "muertes": 0, "dispara": False}
        if choca(x, y):
            self._aparecer(jid)
        self.ultimo_mov[jid] = ahora
        self.completar_con_bots()
        return self.e[jid]

    def salir(self, jid):
        self.e.pop(jid, None)
        for d in (self.ultimo_disparo, self.respawn_en, self.ultimo_mov, self.mente):
            d.pop(jid, None)
        self.completar_con_bots()

    def completar_con_bots(self):
        """Rellena cada equipo hasta 5 con bots, solo si hay al menos un humano."""
        hay_humanos = bool(self.humanos())
        for eq in EQUIPOS:
            bots = [k for k, j in self.e.items() if j.get("bot") and j["equipo"] == eq]
            faltan = (POR_EQUIPO - len(self.humanos(eq))) if hay_humanos else 0
            while len(bots) > max(faltan, 0):
                self.e.pop(bots.pop(), None)
            usados = {j["nombre"].removesuffix(" [BOT]") for j in self.e.values()}
            libres = [n for n in NOMBRES_BOT if n not in usados]
            while len(bots) < faltan:
                bid = f"bot-{eq}-{self.rng.randrange(10**6):06d}"
                self.e[bid] = {"id": bid, "nombre": (libres.pop(0) if libres else bid) + " [BOT]",
                               "equipo": eq, "bot": True, "x": 0.0, "y": 0.0, "dir": 0.0,
                               "vida": VIDA, "bajas": 0, "muertes": 0, "dispara": False}
                self._aparecer(bid)
                bots.append(bid)

    def _aparecer(self, jid):
        j = self.e[jid]
        opciones = APARICIONES[j.get("equipo", "azul")]
        libres = [p for p in opciones if not any(
            o is not j and o.get("vida", 0) > 0 and math.hypot(o["x"] - p[0], o["y"] - p[1]) < 2.5
            for o in self.e.values())]
        x, y = self.rng.choice(libres or opciones)
        j.update(x=float(x), y=float(y), vida=VIDA, dir=0.0 if j.get("equipo") == "azul" else math.pi)
        self.respawn_en.pop(jid, None)

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
        if paso > VELOCIDAD * TOLERANCIA_VEL * dt + 0.5 or choca(x, y):
            return {"x": j["x"], "y": j["y"]}
        j["x"], j["y"] = float(x), float(y)
        self.ultimo_mov[jid] = ahora
        return None

    def disparar(self, jid, ahora):
        """Disparo hitscan calculado por el servidor. Devuelve True si se disparó."""
        j = self.e.get(jid)
        if j is None or j["vida"] <= 0 or self.fin:
            return False
        if ahora - self.ultimo_disparo.get(jid, -1e9) < CADENCIA_S:
            return False                       # cadencia limitada: anti auto-click
        self.ultimo_disparo[jid] = ahora
        dx, dy = math.cos(j["dir"]), math.sin(j["dir"])
        x0, y0 = j["x"] + dx * RADIO * 1.2, j["y"] + dy * RADIO * 1.2
        d = distancia_a_pared(x0, y0, dx, dy)
        victima = None
        for oid, o in self.e.items():
            if oid == jid or o["vida"] <= 0 or o["equipo"] == j["equipo"]:
                continue
            t = _rayo_circulo(x0, y0, dx, dy, o["x"], o["y"])
            if t is not None and t < d:
                d, victima = t, oid
        self.eventos.append({"tipo": "disparo", "de": jid, "x1": round(x0, 2), "y1": round(y0, 2),
                             "x2": round(x0 + dx * d, 2), "y2": round(y0 + dy * d, 2),
                             "impacto": victima is not None})
        if victima:
            self._danar(jid, victima, ahora)
        return True

    def _danar(self, atacante, victima, ahora):
        v = self.e[victima]
        v["vida"] = max(0, v["vida"] - DANO)
        if v["vida"] == 0:
            a = self.e[atacante]
            a["bajas"] += 1
            v["muertes"] += 1
            self.marcador[a["equipo"]] += 1
            self.respawn_en[victima] = ahora + RESPAWN_S
            self.eventos.append({"tipo": "baja", "de": atacante, "a": victima,
                                 "de_nombre": a["nombre"], "a_nombre": v["nombre"]})

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
        for jid, j in list(self.e.items()):
            if j.get("bot"):
                self._pensar_bot(jid, j, ahora, dt)
        transcurrido = ahora - self.inicio
        ganador = next((eq for eq in EQUIPOS if self.marcador[eq] >= META_BAJAS), None)
        if ganador or (self.humanos() and transcurrido >= DURACION_S):
            if not ganador:
                a, r = self.marcador["azul"], self.marcador["rojo"]
                ganador = "azul" if a > r else "rojo" if r > a else "empate"
            self.fin = {"t": ahora, "ganador": ganador, "marcador": dict(self.marcador),
                        "jugadores": sorted(
                            ({"nombre": j["nombre"], "equipo": j["equipo"], "bot": j["bot"],
                              "bajas": j["bajas"], "muertes": j["muertes"]} for j in self.e.values()),
                            key=lambda f: (-f["bajas"], f["muertes"]))}
            self.eventos.append({"tipo": "fin", **{k: v for k, v in self.fin.items() if k != "t"}})
        eventos, self.eventos = self.eventos, []
        return eventos

    def tiempo_restante(self, ahora):
        if self.fin:
            return 0.0
        if not self.humanos():                  # arena vacía: la partida no ha empezado
            return float(DURACION_S)
        return max(0.0, DURACION_S - (ahora - self.inicio))

    # ---- IA de los bots (reglas)
    def _pensar_bot(self, bid, b, ahora, dt):
        if b["vida"] <= 0:
            return
        m = self.mente.setdefault(bid, {"meta": None, "lado": self.rng.choice((-1, 1)),
                                         "cambio": ahora + self.rng.uniform(1, 3)})
        enemigos = [o for o in self.e.values() if o["equipo"] != b["equipo"] and o["vida"] > 0]
        visibles = [o for o in enemigos
                    if math.hypot(o["x"] - b["x"], o["y"] - b["y"]) < 45 and hay_vision(b, o)]
        objetivo = min(visibles, key=lambda o: math.hypot(o["x"] - b["x"], o["y"] - b["y"]),
                       default=None)
        if objetivo:
            dx, dy = objetivo["x"] - b["x"], objetivo["y"] - b["y"]
            dist = math.hypot(dx, dy)
            # apunta con error (no es un aimbot) y dispara con tiempo de reacción
            b["dir"] = math.atan2(dy, dx) + self.rng.gauss(0, 0.06)
            if self.rng.random() < 0.35:
                self.disparar(bid, ahora)
            ux, uy = dx / dist, dy / dist
            if ahora > m["cambio"]:
                m["lado"], m["cambio"] = -m["lado"], ahora + self.rng.uniform(1, 3)
            if b["vida"] <= 35:                       # retirada: se aleja del enemigo
                vx, vy = -ux, -uy
            elif dist > 22:                            # acercarse
                vx, vy = ux + 0.4 * -uy * m["lado"], uy + 0.4 * ux * m["lado"]
            elif dist < 12:                            # demasiado cerca: retroceder
                vx, vy = -ux, -uy
            else:                                      # ametrallar de lado
                vx, vy = -uy * m["lado"], ux * m["lado"]
        else:
            if m["meta"] is None or math.hypot(m["meta"][0] - b["x"], m["meta"][1] - b["y"]) < 3:
                m["meta"] = self._punto_libre()
            dx, dy = m["meta"][0] - b["x"], m["meta"][1] - b["y"]
            dist = math.hypot(dx, dy) or 1
            vx, vy = dx / dist, dy / dist
            b["dir"] = math.atan2(vy, vx)
        n = math.hypot(vx, vy) or 1
        paso = VELOCIDAD * 0.85 * dt
        nx, ny = b["x"] + vx / n * paso, b["y"] + vy / n * paso
        movio = False
        if not choca(nx, b["y"]):
            b["x"], movio = nx, True
        if not choca(b["x"], ny):
            b["y"], movio = ny, True
        if not movio:
            m["meta"] = self._punto_libre()             # atorado: busca otra ruta

    def _punto_libre(self):
        while True:
            x, y = self.rng.uniform(5, 95), self.rng.uniform(5, 95)
            if not choca(x, y, RADIO * 2):
                return (x, y)
