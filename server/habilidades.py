"""Habilidades Q, E y Espacio (s). Todas se validan y ejecutan en el servidor:
enfriamiento, duración, alcance y efectos. El cliente solo pide usarlas.

habilidad() devuelve None si no se usó (enfriamiento, nave muerta, sin
objetivos) o un dict con detalles; si trae "pos", el servidor movió la nave
(desplazamientos) y el cliente debe corregir su posición.
"""
import math

from clases import CLASE_DEFECTO
from geometria import RADIO, deslizar_hasta, hay_vision

GRACIA_DESPLAZAMIENTO_S = 0.3     # mensajes en vuelo con la posición vieja se ignoran


class Habilidades:
    # ---------------------------------------------------------------- utilidades
    def _activo(self, jid, nombre, ahora):
        return self.efectos.get(jid, {}).get(nombre, 0.0) > ahora

    def _poner_efecto(self, jid, nombre, hasta):
        self.efectos.setdefault(jid, {})[nombre] = hasta

    def _listo(self, jid, cual, ahora):
        return self.cds.get(jid, {}).get(cual, 0.0) <= ahora

    def _iniciar_cd(self, jid, cual, ahora):
        j = self.e.get(jid)
        if j is not None:
            self.cds.setdefault(jid, {})[cual] = ahora + self._cfg(j)[cual]["cd"]

    def _mult_vel(self, jid, ahora):
        j = self.e.get(jid)
        if j is None:
            return 1.0
        cfg, m = self._cfg(j), 1.0
        if self._activo(jid, "impulso", ahora):
            m *= cfg["q"]["mult_vel"]
        if self._activo(jid, "fort", ahora):
            m *= cfg["e"]["mult_vel"]
        if jid in self.carga:
            m *= cfg["q"]["mult_vel"]
        return m

    def _campo_que_protege(self, v, ahora):
        for z in self.zonas:
            if z["tipo"] == "campo" and z["equipo"] == v["equipo"] and z["hasta"] > ahora and \
                    math.hypot(v["x"] - z["x"], v["y"] - z["y"]) <= z["r"]:
                return z
        return None

    # ---------------------------------------------------------------- entrada
    def habilidad(self, jid, cual, ahora, ax=None, ay=None, mdx=None, mdy=None):
        j = self.e.get(jid)
        if j is None or j["vida"] <= 0 or self.fin or cual not in ("q", "e", "s"):
            return None
        clase = j.get("clase", CLASE_DEFECTO)
        if not self._listo(jid, cual, ahora):
            return None
        if clase == "phantom" and cual == "q" and jid in self.carga:
            return None                                   # ya está cargando
        h = self._cfg(j)[cual]
        fn = getattr(self, f"_h_{clase}_{cual}", None)
        if fn is None and cual == "s":
            fn = self._h_desplazamiento
        if fn is None:
            return None
        info = fn(jid, j, h, ahora, ax, ay, mdx, mdy)
        if info is None:
            return None
        if not (clase == "phantom" and cual == "q"):      # el del Phantom empieza al disparar
            self._iniciar_cd(jid, cual, ahora)
        evento = {"tipo": "hab", "de": jid, "clase": clase, "hab": cual,
                  "x": round(j["x"], 2), "y": round(j["y"], 2)}
        evento.update({k: v for k, v in info.items() if k != "pos"})
        self.eventos.append(evento)
        self.usos_habilidad.append((clase, cual))
        return info

    # ---------------------------------------------------------------- comunes
    def _desplazar(self, jid, j, dx, dy, dist, ahora):
        x0, y0 = j["x"], j["y"]
        x, y = deslizar_hasta(x0, y0, dx, dy, dist)
        j["x"], j["y"] = round(x, 3), round(y, 3)
        self.ultimo_mov[jid] = ahora
        self.gracia[jid] = ahora + GRACIA_DESPLAZAMIENTO_S
        return {"pos": {"x": j["x"], "y": j["y"]}, "x2": j["x"], "y2": j["y"]}

    def _dir_movimiento(self, j, mdx, mdy):
        if mdx is not None and mdy is not None and math.hypot(mdx, mdy) > 0.1:
            return mdx, mdy
        return math.cos(j["dir"]), math.sin(j["dir"])

    def _h_desplazamiento(self, jid, j, h, ahora, ax, ay, mdx, mdy):
        return self._desplazar(jid, j, *self._dir_movimiento(j, mdx, mdy), h["dist"], ahora)

    # ---------------------------------------------------------------- Interceptor
    def _h_interceptor_q(self, jid, j, h, ahora, *_):
        self._poner_efecto(jid, "impulso", ahora + h["dur"])
        return {"dur": h["dur"]}

    def _h_interceptor_e(self, jid, j, h, ahora, *_):
        info = self._desplazar(jid, j, -math.cos(j["dir"]), -math.sin(j["dir"]), h["dist"], ahora)
        self._poner_efecto(jid, "invulnerable", ahora + h["invulnerable"])
        return info

    # ---------------------------------------------------------------- Titan
    def _h_titan_q(self, jid, j, h, ahora, *_):
        j["escudo"] = h["escudo"]
        self._poner_efecto(jid, "escudo", ahora + h["dur"])
        return {"dur": h["dur"]}

    def _h_titan_e(self, jid, j, h, ahora, *_):
        self._poner_efecto(jid, "fort", ahora + h["dur"])
        return {"dur": h["dur"]}

    # ---------------------------------------------------------------- Spectre
    def _h_spectre_q(self, jid, j, h, ahora, *_):
        curados = 0
        for o in self.e.values():
            if o["equipo"] != j["equipo"] or o["vida"] <= 0:
                continue
            if math.hypot(o["x"] - j["x"], o["y"] - j["y"]) > h["radio"] or not hay_vision(j, o):
                continue
            vmax = self._cfg(o)["vida"]
            if o["vida"] < vmax:
                o["vida"] = min(vmax, o["vida"] + h["cura"])
                curados += 1
        return {"r": h["radio"], "curados": curados}

    def _h_spectre_e(self, jid, j, h, ahora, *_):
        self.zonas.append({"tipo": "campo", "x": j["x"], "y": j["y"], "r": h["radio"],
                           "equipo": j["equipo"], "hasta": ahora + h["dur"],
                           "reduccion": h["reduccion"], "cura_s": h["cura_s"], "de": jid})
        return {"r": h["radio"], "dur": h["dur"]}

    # ---------------------------------------------------------------- Destroyer
    def _h_destroyer_q(self, jid, j, h, ahora, ax, ay, *_):
        if ax is None or ay is None:
            ax = j["x"] + math.cos(j["dir"]) * h["alcance"] * 0.6
            ay = j["y"] + math.sin(j["dir"]) * h["alcance"] * 0.6
        dx, dy = ax - j["x"], ay - j["y"]
        dist = math.hypot(dx, dy)
        if dist > h["alcance"]:                           # se limita al alcance
            ax, ay = j["x"] + dx / dist * h["alcance"], j["y"] + dy / dist * h["alcance"]
        ax, ay = min(99.0, max(1.0, ax)), min(99.0, max(1.0, ay))
        self.zonas.append({"tipo": "bombardeo", "x": ax, "y": ay, "r": h["radio"],
                           "equipo": j["equipo"], "hasta": ahora + h["retardo"],
                           "dano": h["dano"], "de": jid})
        return {"ax": round(ax, 2), "ay": round(ay, 2), "r": h["radio"], "retardo": h["retardo"]}

    def _h_destroyer_e(self, jid, j, h, ahora, *_):
        objetivos = sorted(
            (o for o in self.e.values()
             if o["equipo"] != j["equipo"] and o["vida"] > 0 and
             not self._activo(o["id"], "camo", ahora) and
             math.hypot(o["x"] - j["x"], o["y"] - j["y"]) <= h["alcance"] and hay_vision(j, o)),
            key=lambda o: math.hypot(o["x"] - j["x"], o["y"] - j["y"]))
        for k in range(h["cantidad"]):
            if objetivos:
                o = objetivos[k % len(objetivos)]
                ang = math.atan2(o["y"] - j["y"], o["x"] - j["x"])
            else:                                         # sin objetivos: abanico al frente
                ang = j["dir"] + (k - (h["cantidad"] - 1) / 2) * 0.15
            dx, dy = math.cos(ang), math.sin(ang)
            self._lanzar(jid, j["equipo"], j["x"] + dx * RADIO * 1.3, j["y"] + dy * RADIO * 1.3,
                         dx, dy, h["dano"], h["vel_proy"], h["alcance"], 0.35, "misil")
        return {"objetivos": len(objetivos)}

    # ---------------------------------------------------------------- Phantom
    def _h_phantom_q(self, jid, j, h, ahora, *_):
        self.carga[jid] = ahora                           # el siguiente disparo sale cargado
        return {"carga_max": h["carga_max"]}

    def _h_phantom_e(self, jid, j, h, ahora, *_):
        self._poner_efecto(jid, "camo", ahora + h["dur"])
        self.carga.pop(jid, None)
        return {"dur": h["dur"]}

    # ---------------------------------------------------------------- por tick
    def _actualizar_estados(self, ahora, dt):
        """Vence efectos, resuelve bombardeos, aplica campos y publica en el
        snapshot lo que el HUD necesita (estados y enfriamientos)."""
        for z in [z for z in self.zonas if z["tipo"] == "bombardeo" and z["hasta"] <= ahora]:
            self._explosion(z["de"], z["equipo"], z["x"], z["y"], z["r"], z["dano"], ahora)
        self.zonas = [z for z in self.zonas if z["hasta"] > ahora]
        for z in self.zonas:
            if z["tipo"] != "campo":
                continue
            for o in self.e.values():
                if o["equipo"] == z["equipo"] and o["vida"] > 0 and \
                        math.hypot(o["x"] - z["x"], o["y"] - z["y"]) <= z["r"]:
                    acum = self.cura_acum.get(o["id"], 0.0) + z["cura_s"] * dt
                    entero = int(acum)
                    self.cura_acum[o["id"]] = acum - entero
                    if entero:
                        o["vida"] = min(self._cfg(o)["vida"], o["vida"] + entero)
        for jid, inicio in list(self.carga.items()):      # carga abandonada demasiado tiempo
            j = self.e.get(jid)
            if j is None or ahora - inicio > self._cfg(j)["q"]["max_espera"]:
                self.carga.pop(jid, None)
                self._iniciar_cd(jid, "q", ahora)
        for jid, j in self.e.items():
            efectos = self.efectos.get(jid, {})
            if j.get("escudo") and efectos.get("escudo", 0.0) <= ahora:
                j["escudo"] = 0
            est = {k: 1 for k, t in efectos.items() if t > ahora}
            if jid in self.carga:
                q = self._cfg(j)["q"]
                est["carga"] = round(min(1.0, (ahora - self.carga[jid]) / q["carga_max"]), 2)
            j["est"] = est
            cds = self.cds.get(jid, {})
            j["cd"] = {k: round(max(0.0, cds.get(k, 0.0) - ahora), 1) for k in ("q", "e", "s")}

    def zonas_publicas(self, ahora):
        """Campos de apoyo y bombardeos en curso (t = segundos que les quedan)."""
        return [{"tipo": z["tipo"], "x": round(z["x"], 2), "y": round(z["y"], 2), "r": z["r"],
                 "equipo": z["equipo"], "t": round(max(0.0, z["hasta"] - ahora), 1)}
                for z in self.zonas]
