"""Matchmaker de Nebula Arena: servicio SIN estado (Deployment + HPA, práctica 3.4).

POST /match  {"jugador": "ana", "region": "us-central1"}
  → pide a Agones un GameServer de la flota (GameServerAllocation por la API de
    Kubernetes) y devuelve {"address": ..., "port": ..., "gameServerName": ...}.

No guarda nada en memoria entre peticiones: cualquier réplica puede atender a
cualquier jugador, por eso escala con un HPA por CPU. El llenado de 10
jugadores por servidor lo hace el cliente (el script de Locust, como en el
material), usando el mismo servidor asignado para 10 jugadores.

Dentro del clúster usa la cuenta de servicio del pod (ver k8s/matchmaker.yaml),
que solo tiene permiso de crear GameServerAllocations.
"""
import json
import logging
import os
import re
import ssl
import time
import urllib.error
import urllib.request

from flask import Flask, jsonify, request
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST

FLOTA = os.getenv("FLEET", "nebula-fleet")
NAMESPACE = os.getenv("GS_NAMESPACE", "default")
SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount"
API = "https://kubernetes.default.svc"
ID_VALIDO = re.compile(r"^[A-Za-z0-9_-]{1,32}$")

PETICIONES = Counter("nebula_match_requests_total", "Peticiones de partida", ["resultado"])
LATENCIA = Histogram("nebula_match_seconds", "Tiempo de asignación",
                     buckets=(.01, .025, .05, .1, .25, .5, 1, 2.5))

log = logging.getLogger("matchmaker")
app = Flask(__name__)


def asignar():
    """Crea una GameServerAllocation. Devuelve el dict de status o None si no hay servidores."""
    token = open(f"{SA_DIR}/token").read()
    ctx = ssl.create_default_context(cafile=f"{SA_DIR}/ca.crt")
    cuerpo = {"apiVersion": "allocation.agones.dev/v1", "kind": "GameServerAllocation",
              "spec": {"selectors": [{"matchLabels": {"agones.dev/fleet": FLOTA}}]}}
    req = urllib.request.Request(
        f"{API}/apis/allocation.agones.dev/v1/namespaces/{NAMESPACE}/gameserverallocations",
        data=json.dumps(cuerpo).encode(), method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
        st = json.load(r)["status"]
    if st.get("state") != "Allocated":
        return None                       # UnAllocated: la flota no tiene servidores Ready
    return st


@app.post("/match")
def match():
    d = request.get_json(silent=True)
    if not isinstance(d, dict) or not ID_VALIDO.match(str(d.get("jugador", ""))):
        PETICIONES.labels("invalida").inc()
        return jsonify(error="se requiere 'jugador' (1-32 caracteres: letras, números, _ o -)"), 400
    t0 = time.perf_counter()
    try:
        st = asignar()
    except (urllib.error.URLError, OSError, KeyError, ValueError) as e:
        log.error("error al pedir servidor a Agones: %s", e)
        PETICIONES.labels("error").inc()
        return jsonify(error="no se pudo contactar a Agones"), 502
    finally:
        LATENCIA.observe(time.perf_counter() - t0)
    if st is None:
        PETICIONES.labels("sin_servidores").inc()
        return jsonify(error="no hay servidores disponibles, reintenta"), 503
    PETICIONES.labels("ok").inc()
    return jsonify(address=st["address"], port=st["ports"][0]["port"],
                   gameServerName=st["gameServerName"])


@app.get("/healthz")
def healthz():
    return "ok"


@app.get("/metrics")
def metrics():
    return generate_latest(), 200, {"Content-Type": CONTENT_TYPE_LATEST}


logging.basicConfig(level=logging.INFO)
