"""IA de los bots: máquina de estados por REGLAS (no aprendizaje por refuerzo).

Estados: PATROL, ATTACK, DEFEND, SUPPORT, RETREAT, RESPAWN.

Los bots juegan con las mismas reglas que un humano: usan disparar() y
habilidad() del servidor (misma cadencia, enfriamientos y validación), solo ven
enemigos con línea de visión dentro de su alcance de visión y no detectan a un
Phantom camuflado salvo muy de cerca. Apuntan con error y con un tiempo de
reacción aleatorio, así que no son un aimbot.

Comportamiento por clase:
  interceptor  flanquea, persigue a los enemigos con poca vida, usa impulso
  titan        avanza al frente, protege la zona de sus aliados, usa escudo
  spectre      sigue y repara a sus aliados, pone el campo de apoyo en combate
  destroyer    busca grupos y les lanza bombardeo y misiles, pelea a media distancia
  phantom      busca puestos de tiro, pelea de lejos, carga el railgun,
               se camufla y se retira cuando lo alcanzan
"""
import math

import nav
from clases import CLASE_DEFECTO
from estacion import APARICIONES, PUESTOS_TIRADOR
from geometria import camino_libre, choca, hay_vision

VISION = 45.0
VISION_TIRADOR = 75.0
DETECCION_CAMUFLAJE = 6.0
RUTAS_POR_TICK = 1                # presupuesto de A* por tick (protege el tick rate)

PERFIL = {
    #             distancia preferida, retirada (fracción de vida), prob. de disparo, error
    "interceptor": {"rango": (7, 16), "retirada": 0.3, "disparo": 0.7, "error": 0.07},
    "titan":       {"rango": (9, 22), "retirada": 0.15, "disparo": 0.5, "error": 0.05},
    "spectre":     {"rango": (14, 26), "retirada": 0.35, "disparo": 0.35, "error": 0.06},
    "destroyer":   {"rango": (16, 30), "retirada": 0.3, "disparo": 0.5, "error": 0.06},
    "phantom":     {"rango": (30, 62), "retirada": 0.45, "disparo": 0.6, "error": 0.02},
}


class Bots:
    def _pensar_bot(self, bid, b, ahora, dt):
        m = self.mente.setdefault(bid, {"estado": "PATROL", "meta": None, "ruta": [],
                                         "lado": self.rng.choice((-1, 1)),
                                         "cambio": ahora + self.rng.uniform(1, 3),
                                         "ruta_t": -1e9})
        if b["vida"] <= 0:
            m.update(estado="RESPAWN", ruta=[], meta=None)
            return
        clase = b.get("clase", CLASE_DEFECTO)
        perfil = PERFIL.get(clase, PERFIL[CLASE_DEFECTO])
        vmax = self._cfg(b)["vida"]
        rmin, rmax = perfil["rango"]

        enemigos = self._enemigos_visibles(b, clase, ahora)
        aliados = [o for o in self.e.values()
                   if o["equipo"] == b["equipo"] and o is not b and o["vida"] > 0]
        objetivo = self._elegir_objetivo(b, clase, enemigos)
        dist = self._dist(b, objetivo) if objetivo else math.inf
        cerca = min((self._dist(b, o) for o in enemigos), default=math.inf)

        # ---- estado
        if objetivo and (b["vida"] <= vmax * perfil["retirada"] or
                         (clase == "phantom" and cerca < 12)):
            estado = "RETREAT"
        elif objetivo:
            estado = "ATTACK"
        elif clase == "spectre" and aliados:
            estado = "SUPPORT"
        elif clase == "titan" and aliados:
            estado = "DEFEND"
        else:
            estado = "PATROL"
        if estado != m["estado"]:
            m["meta"], m["ruta"] = None, []
        m["estado"] = estado

        # ---- habilidades (con tiempo de reacción: no las usa en el primer tick posible)
        if self.rng.random() < 0.15:
            self._usar_habilidades(bid, b, clase, estado, objetivo, dist, cerca, aliados, enemigos, ahora)

        # ---- apuntar y disparar
        if objetivo:
            ax, ay = self._anticipar(b, objetivo, clase)
            b["dir"] = math.atan2(ay - b["y"], ax - b["x"]) + self.rng.gauss(0, perfil["error"])
            alcance = self._cfg(b)["arma"]["alcance"]
            cargando = bid in self.carga
            listo_carga = not cargando or b.get("est", {}).get("carga", 0) >= 0.85 or cerca < 15
            if dist <= alcance and listo_carga and self.rng.random() < perfil["disparo"]:
                self.disparar(bid, ahora)

        # ---- moverse
        if ahora > m["cambio"]:
            m["lado"], m["cambio"] = -m["lado"], ahora + self.rng.uniform(1, 3)
        vx = vy = 0.0
        meta = None
        if estado == "ATTACK":
            ux, uy = (objetivo["x"] - b["x"]) / dist, (objetivo["y"] - b["y"]) / dist
            if dist > rmax:
                if clase == "interceptor":            # flanco: llega por un costado
                    meta = (objetivo["x"] - uy * 8 * m["lado"], objetivo["y"] + ux * 8 * m["lado"])
                else:
                    meta = (objetivo["x"], objetivo["y"])
            elif dist < rmin:
                vx, vy = -ux, -uy
            else:                                      # dentro del rango: ametrallar de lado
                vx, vy = -uy * m["lado"], ux * m["lado"]
        elif estado == "RETREAT":
            meta = self._refugio(b, clase, enemigos)
        elif estado == "SUPPORT":
            herido = min(aliados, key=lambda o: (o["vida"] / self._cfg(o)["vida"], self._dist(b, o)))
            if self._dist(b, herido) > 5:
                meta = (herido["x"], herido["y"])
        elif estado == "DEFEND":
            cx = sum(o["x"] for o in aliados) / len(aliados)
            cy = sum(o["y"] for o in aliados) / len(aliados)
            frente = (cx * 0.6 + 50 * 0.4, cy * 0.6 + 50 * 0.4)
            if math.hypot(frente[0] - b["x"], frente[1] - b["y"]) > 4:
                meta = frente
        else:                                           # PATROL
            if m["meta"] is None or math.hypot(m["meta"][0] - b["x"], m["meta"][1] - b["y"]) < 3:
                m["meta"] = self._punto_patrulla(b, clase)
            meta = m["meta"]
        if meta is not None:
            vx, vy = self._seguir(bid, b, m, meta, ahora)
            if not objetivo:
                b["dir"] = math.atan2(vy, vx) if (vx or vy) else b["dir"]
        self._paso_bot(bid, b, m, vx, vy, ahora, dt)

    # ---------------------------------------------------------------- percepción
    @staticmethod
    def _dist(a, b):
        return math.hypot(a["x"] - b["x"], a["y"] - b["y"])

    def _enemigos_visibles(self, b, clase, ahora):
        vision = VISION_TIRADOR if clase == "phantom" else VISION
        vistos = []
        for o in self.e.values():
            if o["equipo"] == b["equipo"] or o["vida"] <= 0:
                continue
            d = self._dist(b, o)
            if d > vision:
                continue
            if self._activo(o["id"], "camo", ahora) and d > DETECCION_CAMUFLAJE:
                continue                                # camuflado: no lo ve
            if hay_vision(b, o):
                vistos.append(o)
        return vistos

    def _elegir_objetivo(self, b, clase, enemigos):
        if not enemigos:
            return None
        if clase == "interceptor":                     # prefiere a los débiles
            return min(enemigos, key=lambda o: o["vida"] + self._dist(b, o) * 2)
        if clase == "phantom":                         # objetivos prioritarios: poca vida, lejos está bien
            return min(enemigos, key=lambda o: o["vida"] - self._dist(b, o) * 0.3)
        return min(enemigos, key=lambda o: self._dist(b, o))

    def _anticipar(self, b, o, clase):
        """Apunta adelante de un objetivo en movimiento si el arma es un proyectil."""
        arma = self._cfg(b)["arma"]
        if arma["tipo"] != "proyectil":
            return o["x"], o["y"]
        vx, vy = self.vel_est.get(o["id"], (0.0, 0.0))
        t = self._dist(b, o) / arma["vel_proy"]
        return o["x"] + vx * t, o["y"] + vy * t

    # ---------------------------------------------------------------- habilidades
    def _usar_habilidades(self, bid, b, clase, estado, objetivo, dist, cerca, aliados, enemigos, ahora):
        vmax = self._cfg(b)["vida"]
        lejos_de = None
        if objetivo:
            lejos_de = (b["x"] - objetivo["x"], b["y"] - objetivo["y"])
        hab = self.habilidad
        if clase == "interceptor":
            if objetivo and (dist > 18 or estado == "RETREAT"):
                hab(bid, "q", ahora)
            if estado == "RETREAT" and cerca < 15:
                hab(bid, "e", ahora)
            elif objetivo and dist > 22:
                hab(bid, "s", ahora, mdx=objetivo["x"] - b["x"], mdy=objetivo["y"] - b["y"])
        elif clase == "titan":
            if objetivo and b["vida"] < vmax * 0.8:
                hab(bid, "q", ahora)
            if objetivo and b["vida"] < vmax * 0.5 and cerca < 20:
                hab(bid, "e", ahora)
        elif clase == "spectre":
            grupo = aliados + [b]
            if any(o["vida"] < self._cfg(o)["vida"] * 0.6 and self._dist(b, o) < 14 for o in grupo):
                hab(bid, "q", ahora)
            if objetivo and (sum(1 for o in aliados if self._dist(b, o) < 10) >= 1 or b["vida"] < vmax * 0.6):
                hab(bid, "e", ahora)
            if estado == "RETREAT" and lejos_de:
                hab(bid, "s", ahora, mdx=lejos_de[0], mdy=lejos_de[1])
        elif clase == "destroyer":
            if objetivo and dist <= 38:
                grupo = [o for o in enemigos if self._dist(o, objetivo) <= 7]
                cx = sum(o["x"] for o in grupo) / len(grupo)
                cy = sum(o["y"] for o in grupo) / len(grupo)
                hab(bid, "q", ahora, ax=cx, ay=cy)
            if objetivo and dist <= 40:
                hab(bid, "e", ahora)
        elif clase == "phantom":
            if objetivo and dist > 25 and cerca > 15 and bid not in self.carga:
                hab(bid, "q", ahora)
            if estado == "RETREAT" and cerca < 18:
                hab(bid, "e", ahora)
            if cerca < 12 and lejos_de:
                hab(bid, "s", ahora, mdx=lejos_de[0], mdy=lejos_de[1])

    # ---------------------------------------------------------------- movimiento
    def _refugio(self, b, clase, enemigos):
        if clase == "phantom":
            puestos = PUESTOS_TIRADOR[b["equipo"]]
            return max(puestos, key=lambda p: min((math.hypot(p[0] - o["x"], p[1] - o["y"])
                                                   for o in enemigos), default=0))
        base = APARICIONES[b["equipo"]]
        return base[len(base) // 2]

    def _punto_patrulla(self, b, clase):
        if clase == "phantom" and self.rng.random() < 0.7:
            return self.rng.choice(PUESTOS_TIRADOR[b["equipo"]])
        return self._punto_libre()

    def _seguir(self, bid, b, m, meta, ahora):
        """Dirección hacia la meta; usa A* si no hay paso en línea recta."""
        if camino_libre(b["x"], b["y"], meta[0], meta[1]):
            m["ruta"] = []
            dx, dy = meta[0] - b["x"], meta[1] - b["y"]
        else:
            fin = m["ruta"][-1] if m["ruta"] else None
            vieja = fin is None or math.hypot(fin[0] - meta[0], fin[1] - meta[1]) > 5 or \
                ahora - m["ruta_t"] > 2.5
            if vieja and self.rutas_tick < RUTAS_POR_TICK:
                self.rutas_tick += 1
                m["ruta"], m["ruta_t"] = nav.ruta(b["x"], b["y"], *meta), ahora
            while m["ruta"] and math.hypot(m["ruta"][0][0] - b["x"], m["ruta"][0][1] - b["y"]) < 1.5:
                m["ruta"].pop(0)
            p = m["ruta"][0] if m["ruta"] else meta
            dx, dy = p[0] - b["x"], p[1] - b["y"]
        n = math.hypot(dx, dy)
        return (dx / n, dy / n) if n > 1e-6 else (0.0, 0.0)

    def _paso_bot(self, bid, b, m, vx, vy, ahora, dt):
        n = math.hypot(vx, vy)
        if n < 1e-6:
            return
        paso = self._cfg(b)["velocidad"] * self._mult_vel(bid, ahora) * 0.9 * dt
        nx, ny = b["x"] + vx / n * paso, b["y"] + vy / n * paso
        movio = False
        if not choca(nx, b["y"]):
            b["x"], movio = nx, True
        if not choca(b["x"], ny):
            b["y"], movio = ny, True
        if not movio:                                   # atorado: otra meta y otra ruta
            m["meta"], m["ruta"] = self._punto_libre(), []
            m["lado"] = -m["lado"]
