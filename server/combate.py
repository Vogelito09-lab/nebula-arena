"""Combate autoritativo: armas, proyectiles, explosiones, daño y bajas.

El servidor decide todo impacto. El cliente solo dibuja lo que llega en los
eventos del snapshot:
  disparo     rayo instantáneo o railgun (x1, y1 → x2, y2, impacto)
  proy        nace un proyectil (posición, velocidad y alcance; el cliente lo
              avanza en línea recta, así no hace falta mandar cada posición)
  proy_fin    el proyectil chocó o se agotó
  explosion   daño de área
  baja        eliminación, con asistencias
"""
import math

import clases
from geometria import (RADIO, _rayo_circulo, distancia_a_borde, distancia_a_pared,
                       rayo_circulo, vision_entre)

MAX_PROYECTILES = 150             # límite para proteger el tick
VENTANA_ASISTENCIA_S = 5.0        # daño en los 5 s previos a la baja = asistencia


class Combate:
    # ---------------------------------------------------------------- disparo
    def disparar(self, jid, ahora):
        """Dispara el arma de la clase. Devuelve True si se disparó."""
        j = self.e.get(jid)
        if j is None or j["vida"] <= 0 or self.fin:
            return False
        if self._activo(jid, "camo", ahora):
            return False                       # camuflado no puede disparar
        arma = self._cfg(j)["arma"]
        if ahora - self.ultimo_disparo.get(jid, -1e9) < arma["cadencia"]:
            return False                       # cadencia limitada: anti auto-click
        self.ultimo_disparo[jid] = ahora
        dx, dy = math.cos(j["dir"]), math.sin(j["dir"])
        x0, y0 = j["x"] + dx * RADIO * 1.2, j["y"] + dy * RADIO * 1.2
        if arma["tipo"] == "instantaneo":
            self._instantaneo(jid, j, x0, y0, dx, dy, arma, ahora)
        elif arma["tipo"] == "railgun":
            self._railgun(jid, j, x0, y0, dx, dy, arma, ahora)
        else:
            self._lanzar(jid, j["equipo"], x0, y0, dx, dy, arma["dano"], arma["vel_proy"],
                         arma["alcance"], arma.get("radio_proy", 0.3), "canon",
                         arma.get("radio_expl", 0.0), arma.get("dano_expl", 0))
        return True

    def _instantaneo(self, jid, j, x0, y0, dx, dy, arma, ahora):
        """El disparo de la versión 1.2, sin cambios de comportamiento."""
        d = distancia_a_pared(x0, y0, dx, dy, arma["alcance"])
        victima = None
        for oid, o in self.e.items():
            if oid == jid or o["vida"] <= 0 or o["equipo"] == j["equipo"]:
                continue
            t = _rayo_circulo(x0, y0, dx, dy, o["x"], o["y"])
            if t is not None and t < d:
                d, victima = t, oid
        self.eventos.append({"tipo": "disparo", "de": jid, "arma": "pulso",
                             "x1": round(x0, 2), "y1": round(y0, 2),
                             "x2": round(x0 + dx * d, 2), "y2": round(y0 + dy * d, 2),
                             "impacto": victima is not None})
        if victima:
            self._danar(jid, victima, ahora, arma["dano"])

    def _railgun(self, jid, j, x0, y0, dx, dy, arma, ahora):
        """Atraviesa a todos los enemigos alineados hasta la primera pared."""
        extra, carga = 0, 0.0
        inicio = self.carga.pop(jid, None)
        if inicio is not None:                 # disparo de precisión (Q) cargado
            q = self._cfg(j)["q"]
            carga = min(1.0, (ahora - inicio) / q["carga_max"])
            extra = round(q["dano_extra"] * carga)
            self._iniciar_cd(jid, "q", ahora)
        d = distancia_a_pared(x0, y0, dx, dy, arma["alcance"])
        golpes = []
        for oid, o in self.e.items():
            if oid == jid or o["vida"] <= 0 or o["equipo"] == j["equipo"]:
                continue
            t = rayo_circulo(x0, y0, dx, dy, o["x"], o["y"])
            if t is not None and t < d:
                golpes.append((t, oid))
        self.eventos.append({"tipo": "disparo", "de": jid, "arma": "railgun",
                             "x1": round(x0, 2), "y1": round(y0, 2),
                             "x2": round(x0 + dx * d, 2), "y2": round(y0 + dy * d, 2),
                             "impacto": bool(golpes), "carga": round(carga, 2)})
        for _, oid in sorted(golpes):
            self._danar(jid, oid, ahora, arma["dano"] + extra)

    # ---------------------------------------------------------------- proyectiles
    def _lanzar(self, jid, equipo, x, y, dx, dy, dano, vel, alcance, radio, arma,
                radio_expl=0.0, dano_expl=0):
        if len(self.proy) >= MAX_PROYECTILES:
            return None
        pid = self.sig_proy
        self.sig_proy += 1
        self.proy[pid] = {"x": x, "y": y, "dx": dx, "dy": dy, "vel": vel, "resto": alcance,
                          "de": jid, "equipo": equipo, "dano": dano, "radio": radio,
                          "arma": arma, "re": radio_expl, "de_expl": dano_expl}
        self.eventos.append({"tipo": "proy", "id": pid, "de": jid, "arma": arma,
                             "x": round(x, 2), "y": round(y, 2),
                             "vx": round(dx * vel, 2), "vy": round(dy * vel, 2),
                             "alc": alcance})
        return pid

    def _mover_proyectiles(self, ahora, dt):
        for pid, p in list(self.proy.items()):
            largo = min(p["vel"] * dt, p["resto"])
            ux, uy = p["dx"], p["dy"]
            pared = min(distancia_a_pared(p["x"], p["y"], ux, uy, largo),
                        distancia_a_borde(p["x"], p["y"], ux, uy))
            t, victima = pared, None
            for oid, o in self.e.items():
                if o["vida"] <= 0 or o["equipo"] == p["equipo"]:
                    continue
                tc = rayo_circulo(p["x"], p["y"], ux, uy, o["x"], o["y"], RADIO + p["radio"])
                if tc is not None and tc <= t:
                    t, victima = tc, oid
            if victima is not None or t < largo:
                hx, hy = p["x"] + ux * t, p["y"] + uy * t
                del self.proy[pid]
                self.eventos.append({"tipo": "proy_fin", "id": pid, "x": round(hx, 2),
                                     "y": round(hy, 2), "impacto": victima is not None})
                if victima is not None:
                    self._danar(p["de"], victima, ahora, p["dano"])
                if p["re"]:
                    self._explosion(p["de"], p["equipo"], hx, hy, p["re"], p["de_expl"],
                                    ahora, excluir=victima)
                continue
            p["x"] += ux * largo
            p["y"] += uy * largo
            p["resto"] -= largo
            if p["resto"] <= 1e-6:
                del self.proy[pid]
                self.eventos.append({"tipo": "proy_fin", "id": pid, "x": round(p["x"], 2),
                                     "y": round(p["y"], 2), "impacto": False})

    def _explosion(self, de, equipo, x, y, radio, dano, ahora, excluir=None):
        """Daño de área. Las paredes protegen: hace falta línea de visión al centro."""
        self.eventos.append({"tipo": "explosion", "de": de, "x": round(x, 2),
                             "y": round(y, 2), "r": radio})
        for oid, o in list(self.e.items()):
            if oid == excluir or o["vida"] <= 0 or o["equipo"] == equipo:
                continue
            if math.hypot(o["x"] - x, o["y"] - y) <= radio + RADIO and \
                    vision_entre(x, y, o["x"], o["y"]):
                self._danar(de, oid, ahora, dano)

    # ---------------------------------------------------------------- daño
    def _danar(self, atacante, victima, ahora, dano=None):
        """Aplica daño con todos los modificadores. Devuelve el daño a la vida."""
        v = self.e.get(victima)
        if v is None or v["vida"] <= 0:
            return 0
        if dano is None:
            dano = clases.clase(None)["arma"]["dano"]
        if self._activo(victima, "invulnerable", ahora):
            return 0
        mult = 1.0
        if self._activo(victima, "fort", ahora):
            mult *= 1 - self._cfg(v)["e"]["reduccion"]
        campo = self._campo_que_protege(v, ahora)
        if campo:
            mult *= 1 - campo["reduccion"]
        dano = max(1, round(dano * mult))
        escudo = v.get("escudo", 0)
        if escudo:
            absorbido = min(escudo, dano)
            v["escudo"] = escudo - absorbido
            dano -= absorbido
        v["vida"] = max(0, v["vida"] - dano)
        if self._activo(victima, "camo", ahora):     # el daño revela al camuflado
            self.efectos[victima].pop("camo", None)
            self.eventos.append({"tipo": "revelado", "a": victima})
        if atacante in self.e and atacante != victima:
            self.dano_reciente.setdefault(victima, {})[atacante] = ahora
        if v["vida"] == 0:
            self._baja(atacante, victima, ahora)
        return dano

    def _baja(self, atacante, victima, ahora):
        v = self.e[victima]
        a = self.e.get(atacante)
        v["muertes"] += 1
        self.respawn_en[victima] = ahora + self.RESPAWN_S
        if a is not None:
            a["bajas"] += 1
            self.marcador[a["equipo"]] += 1
        asistentes = [k for k, t in self.dano_reciente.pop(victima, {}).items()
                      if k != atacante and k in self.e and ahora - t <= VENTANA_ASISTENCIA_S
                      and self.e[k]["equipo"] != v["equipo"]]
        for k in asistentes:
            self.e[k]["asist"] = self.e[k].get("asist", 0) + 1
        self.carga.pop(victima, None)
        self.efectos.pop(victima, None)
        v["escudo"] = 0
        self.eventos.append({"tipo": "baja", "de": atacante, "a": victima,
                             "de_nombre": a["nombre"] if a else "?",
                             "a_nombre": v["nombre"],
                             "asist": [self.e[k]["nombre"] for k in asistentes]})
