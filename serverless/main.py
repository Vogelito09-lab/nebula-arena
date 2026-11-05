"""Práctica 3.5 — Tabla de líderes serverless (Cloud Run + Firestore).

Basado en el ejemplo del material (mismos endpoints y misma colección "scores"):

  POST /score  {"jugador": "ana", "puntos": 1250, "resultado": "victoria"}
      Suma los puntos y cuenta la partida. "resultado" es opcional
      ("victoria" | "derrota") y lleva la cuenta de victorias y derrotas.
  GET  /top    Top 10 global: posición, jugador, puntos, partidas, victorias, derrotas.
  GET  /jugador/<id>  Estadísticas de un jugador.

Seguridad:
  - Validación de entradas (id del jugador, puntos enteros en un rango razonable).
  - Si existe la variable SCORE_API_KEY, POST /score exige la cabecera
    X-Api-Key con ese valor: solo los servidores de partida registran puntajes.
    La llave se guarda en Secret Manager, nunca en el repositorio.

El archivo se llama main.py para que Cloud Run lo arranque con gunicorn main:app.
"""
import hmac
import logging
import os
import re

from flask import Flask, jsonify, request

ID_VALIDO = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
MAX_PUNTOS = 100_000                 # por partida; evita valores absurdos
TOP_N = 10

app = Flask(__name__)
log = logging.getLogger("leaderboard")
_db = None


def db():
    """Cliente de Firestore creado al primer uso (las pruebas lo sustituyen)."""
    global _db
    if _db is None:
        from google.cloud import firestore
        _db = firestore.Client()
    return _db


def incremento(n):
    from google.cloud import firestore
    return firestore.Increment(n)


def _autorizado():
    llave = os.getenv("SCORE_API_KEY")
    if not llave:
        return True
    return hmac.compare_digest(request.headers.get("X-Api-Key", ""), llave)


@app.post("/score")
def guardar():
    if not _autorizado():
        return jsonify(error="no autorizado"), 401
    d = request.get_json(silent=True)
    if not isinstance(d, dict):
        return jsonify(error="se esperaba un objeto JSON"), 400
    jugador, puntos, resultado = d.get("jugador"), d.get("puntos"), d.get("resultado")
    if not isinstance(jugador, str) or not ID_VALIDO.match(jugador):
        return jsonify(error="'jugador': 1-32 caracteres (letras, números, _ o -)"), 400
    if not isinstance(puntos, int) or isinstance(puntos, bool) or not 0 <= puntos <= MAX_PUNTOS:
        return jsonify(error=f"'puntos': entero entre 0 y {MAX_PUNTOS}"), 400
    if resultado not in (None, "victoria", "derrota"):
        return jsonify(error="'resultado': 'victoria' o 'derrota'"), 400
    cambios = {"puntos": incremento(puntos), "partidas": incremento(1)}
    if resultado == "victoria":
        cambios["victorias"] = incremento(1)
    elif resultado == "derrota":
        cambios["derrotas"] = incremento(1)
    db().collection("scores").document(jugador).set(cambios, merge=True)
    return "ok", 201


def _fila(doc):
    d = doc.to_dict() or {}
    return {"jugador": doc.id, "puntos": int(d.get("puntos", 0)),
            "partidas": int(d.get("partidas", 0)),
            "victorias": int(d.get("victorias", 0)),
            "derrotas": int(d.get("derrotas", 0))}


@app.get("/top")
def top():
    from google.cloud.firestore import Query
    q = db().collection("scores").order_by("puntos", direction=Query.DESCENDING).limit(TOP_N)
    return jsonify([{"posicion": i, **_fila(doc)} for i, doc in enumerate(q.stream(), 1)])


@app.get("/jugador/<jugador>")
def jugador(jugador):
    if not ID_VALIDO.match(jugador):
        return jsonify(error="id de jugador inválido"), 400
    doc = db().collection("scores").document(jugador).get()
    if not doc.exists:
        return jsonify(error="jugador no encontrado"), 404
    return jsonify(_fila(doc))


@app.get("/healthz")
def healthz():
    return "ok"


@app.errorhandler(Exception)
def error(e):
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return jsonify(error=e.description), e.code
    log.exception("error no controlado")
    return jsonify(error="error interno"), 500
