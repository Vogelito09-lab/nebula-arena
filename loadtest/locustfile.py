"""Práctica 3.4 — Jugadores y espectadores simulados con Locust.

Basado en el locustfile del material. Cada Jugador:
  1. pide un servidor (como lo haría el matchmaker),
  2. abre un WebSocket y envía su posición 20 veces por segundo,
  3. una vez por segundo mide el RTT con un ping (no con el snapshot, que
     llega hasta 50 ms después y mezclaría la espera del tick con la red).
Un mini-matchmaker compartido llena cada servidor con 10 jugadores antes de
pedir otro.

Cómo pide servidores (elige uno con variables de entorno):
  MATCHMAKER_URL=http://<ip>        → POST /match al matchmaker del clúster (k8s/matchmaker.yaml)
  ALLOCATOR_IP=<ip>                 → servicio agones-allocator con certificados
                                      client.crt, client.key y ca.crt (opción del material)

Escenarios del material:
  locust -f locustfile.py Jugador -u 1000 -r 2  -t 20m --headless --processes -1 --csv rampa
  locust -f locustfile.py Jugador -u 1000 -r 50 -t 10m --headless --processes -1 --csv pico
  locust -f locustfile.py Espectador --host http://<IP-CDN> -u 500 -r 50 -t 5m \
         --headless --processes -1 --csv stream
"""
import json
import os
import random
import time
import uuid

import requests
from gevent.lock import Semaphore
from locust import HttpUser, User, constant, constant_pacing, events, task
from websocket import create_connection          # pip install websocket-client

MATCHMAKER_URL = os.environ.get("MATCHMAKER_URL", "").rstrip("/")
ALLOCATOR = f"https://{os.environ.get('ALLOCATOR_IP', '')}/gameserverallocation"
PEDIDO = {"namespace": "default",
          "gameServerSelectors": [{"matchLabels": {"agones.dev/fleet": "nebula-fleet"}}]}
CERTS = {"cert": ("client.crt", "client.key"),
         "verify": os.environ.get("ALLOCATOR_CA", "ca.crt")}
if CERTS["verify"].lower() == "false":           # laboratorio: certificado sin la IP
    CERTS["verify"] = False
JUGADORES_POR_PARTIDA = 10
REINTENTOS = 10                                  # si la flota aún no escala, reintenta


def medir(nombre, inicio, error=None, tipo="WS"):
    events.request.fire(request_type=tipo, name=nombre,
                        response_time=(time.perf_counter() - inicio) * 1000,
                        response_length=0, exception=error)


def pedir_a_agones():
    """Devuelve 'ip:puerto' de un GameServer asignado."""
    if MATCHMAKER_URL:
        r = requests.post(f"{MATCHMAKER_URL}/match",
                          json={"jugador": uuid.uuid4().hex[:8]}, timeout=10)
        r.raise_for_status()
        gs = r.json()
        return f"{gs['address']}:{gs['port']}"
    r = requests.post(ALLOCATOR, json=PEDIDO, timeout=10, **CERTS)
    r.raise_for_status()
    gs = r.json()
    if not gs.get("ports"):
        raise RuntimeError("la flota no tiene servidores Ready")
    return f"{gs['address']}:{gs['ports'][0]['port']}"


class Jugador(User):
    wait_time = constant(0.05)                 # 20 mensajes por segundo
    sala = {"addr": None, "cupo": 0}           # mini-matchmaker compartido
    candado = Semaphore()

    def pedir_servidor(self):
        with Jugador.candado:                  # un solo pedido a la vez
            if Jugador.sala["cupo"] == 0:      # sala llena: pide otro servidor
                for intento in range(REINTENTOS):
                    t0 = time.perf_counter()
                    try:
                        addr = pedir_a_agones()
                        medir("asignacion", t0, tipo="HTTP")
                        break
                    except Exception as e:     # 503 = flota sin servidores Ready
                        medir("asignacion", t0, e, tipo="HTTP")
                        time.sleep(min(2 ** intento, 10))
                else:
                    raise RuntimeError("no se obtuvo servidor tras varios intentos")
                Jugador.sala = {"addr": addr, "cupo": JUGADORES_POR_PARTIDA}
            Jugador.sala["cupo"] -= 1
            return Jugador.sala["addr"]

    def on_start(self):
        self.id, self.n = uuid.uuid4().hex[:8], 0
        self.x, self.y = random.uniform(0, 100), random.uniform(0, 100)
        t0 = time.perf_counter()
        try:
            self.ws = create_connection(f"ws://{self.pedir_servidor()}", timeout=5)
            medir("conexion", t0)
        except Exception as e:
            medir("conexion", t0, e)
            self.ws = None
            self.stop()

    @task
    def jugar(self):
        if self.ws is None:
            return
        self.x = min(100, max(0, self.x + random.uniform(-1, 1)))
        self.y = min(100, max(0, self.y + random.uniform(-1, 1)))
        try:
            self.ws.send(json.dumps({"id": self.id, "x": self.x, "y": self.y,
                                     "dispara": random.random() < 0.1}))
        except Exception as e:                 # desconexión inesperada
            medir("desconexion", time.perf_counter(), e)
            self.ws = None
            self.stop()
            return
        self.n += 1
        if self.n % 20 == 0:                   # un ping por segundo
            t0 = time.perf_counter()
            try:
                self.ws.send(json.dumps({"ping": t0}))
                while json.loads(self.ws.recv()).get("pong") != t0:
                    pass                       # descarta los snapshots acumulados
                medir("rtt", t0)
            except Exception as e:
                medir("rtt", t0, e)

    def on_stop(self):
        if getattr(self, "ws", None):
            self.ws.close()


class Espectador(HttpUser):
    wait_time = constant_pacing(2)             # un segmento cada 2 s, como el reproductor

    def on_start(self):
        self.i = random.randint(0, 100)        # cada espectador empieza en otro punto

    @task
    def ver_stream(self):
        m = self.client.get("/live/nebula/360p.m3u8", name="manifiesto")
        segmentos = [l for l in m.text.splitlines() if l.endswith(".ts")]
        if not segmentos:
            return
        seg = segmentos[self.i % len(segmentos)]; self.i += 1
        with self.client.get(f"/live/nebula/{seg}", name="segmento",
                             catch_response=True) as r:
            if r.elapsed.total_seconds() > 2:
                r.failure("rebuffering: el segmento tardó más de lo que dura")
