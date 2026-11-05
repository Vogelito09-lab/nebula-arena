"""Servidor de partida de Nebula Arena (práctica 3.3).

Basado en el servidor mínimo del material de la Unidad 3:
- Acepta hasta 10 jugadores (partida 5 vs 5).
- Retransmite el estado a 20 ticks por segundo por WebSocket.
- Expone métricas Prometheus en :9100/metrics.
- Informa su ciclo de vida a Agones: /ready, /health y /shutdown.

Cambios respecto al ejemplo del material (mismos nombres de métricas y protocolo):
- Valida cada mensaje: JSON roto, tipos incorrectos o coordenadas fuera de la
  arena se descartan sin tumbar la conexión.
- Cada conexión queda ligada al primer id que envía: un cliente no puede
  sobrescribir la posición de otro jugador.
- Métricas extra: tick rate efectivo y desconexiones.
"""
import asyncio
import json
import logging
import math
import os
import time
import urllib.request

import websockets
from prometheus_client import Counter, Gauge, Histogram, start_http_server

MAX_JUGADORES = 10                      # partida 5 vs 5
TICK_S = 0.05                           # 20 ticks por segundo
PUERTO_JUEGO = int(os.getenv("GAME_PORT", "7654"))
PUERTO_METRICAS = int(os.getenv("METRICS_PORT", "9100"))
ARENA = 100.0                           # la arena mide 100 x 100 unidades
MAX_ID = 32                             # longitud máxima del id del jugador

JUGADORES = Gauge("nebula_players_connected", "Jugadores conectados")
TICK = Histogram("nebula_tick_seconds", "Duración del tick",
                 buckets=(.001, .0025, .005, .01, .025, .05, .1))
TICK_RATE = Gauge("nebula_tick_rate", "Ticks por segundo efectivos (ventana de 2 s)")
DESCONEXIONES = Counter("nebula_disconnects_total",
                        "Conexiones cerradas", ["motivo"])
MENSAJES_INVALIDOS = Counter("nebula_invalid_messages_total",
                             "Mensajes descartados por la validación")

log = logging.getLogger("nebula")
estado, conexiones = {}, set()
partida = {"iniciada": False}

SDK = f"http://localhost:{os.getenv('AGONES_SDK_HTTP_PORT', '9358')}"


def agones(ruta):
    """Llama al SDK REST de Agones (contenedor auxiliar). Fuera de Agones se ignora."""
    try:
        req = urllib.request.Request(SDK + ruta, data=b"{}", method="POST",
                                     headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=1)
        return True
    except Exception:
        return False


def snapshot():
    return json.dumps({"t": time.time(), "e": estado})


def _numero(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def validar(d, mi_id):
    """Devuelve el estado limpio del jugador o None si el mensaje no es válido.

    mi_id es el id ya ligado a la conexión (None si aún no envió ninguno).
    """
    if not isinstance(d, dict):
        return None
    jid = d.get("id")
    if not isinstance(jid, str) or not 0 < len(jid) <= MAX_ID:
        return None
    if mi_id is not None and jid != mi_id:       # no puede hacerse pasar por otro
        return None
    x, y = d.get("x"), d.get("y")
    if not (_numero(x) and _numero(y)):
        return None
    if not (0 <= x <= ARENA and 0 <= y <= ARENA):
        return None
    return {"id": jid, "x": float(x), "y": float(y),
            "dispara": d.get("dispara") is True}


async def jugador(ws):
    if len(conexiones) >= MAX_JUGADORES:
        await ws.close(code=4000, reason="partida llena")
        DESCONEXIONES.labels("partida_llena").inc()
        return
    conexiones.add(ws)
    JUGADORES.set(len(conexiones))
    partida["iniciada"] = True
    mi_id = None
    motivo = "normal"
    try:
        async for msg in ws:
            try:
                d = json.loads(msg)
            except (ValueError, TypeError):
                MENSAJES_INVALIDOS.inc()
                continue
            if isinstance(d, dict) and "ping" in d:   # latencia: responde al instante
                if _numero(d["ping"]):
                    await ws.send(json.dumps({"pong": d["ping"]}))
                else:
                    MENSAJES_INVALIDOS.inc()
                continue
            limpio = validar(d, mi_id)
            if limpio is None:
                MENSAJES_INVALIDOS.inc()
                continue
            if mi_id is None:
                if limpio["id"] in estado:           # id ocupado por otra conexión
                    MENSAJES_INVALIDOS.inc()
                    continue
                mi_id = limpio["id"]
            estado[mi_id] = limpio
    except websockets.ConnectionClosedError:
        motivo = "error"
    finally:
        conexiones.discard(ws)
        JUGADORES.set(len(conexiones))
        if mi_id is not None:
            estado.pop(mi_id, None)                  # el jugador sale del estado
        DESCONEXIONES.labels(motivo).inc()


async def bucle():
    n = 0
    ventana_t, ventana_n = time.perf_counter(), 0
    while True:
        t = time.perf_counter()
        # tick rate efectivo: ticks iniciados en la ventana / duración de la ventana
        if t - ventana_t >= 2:
            TICK_RATE.set(ventana_n / (t - ventana_t))
            ventana_t, ventana_n = t, 0
        ventana_n += 1
        if conexiones:
            websockets.broadcast(conexiones, snapshot())
        TICK.observe(time.perf_counter() - t)
        n += 1
        if n % 40 == 0:                              # latido a Agones cada 2 s
            await asyncio.to_thread(agones, "/health")
        if partida["iniciada"] and not conexiones:
            log.info("partida terminada: todos los jugadores salieron")
            await asyncio.to_thread(agones, "/shutdown")   # fin de partida
            partida["iniciada"] = False
        # descuenta lo que tardó el tick para mantener 20 Hz reales
        await asyncio.sleep(max(0.0, TICK_S - (time.perf_counter() - t)))


async def anunciar_ready(intervalo=1.0):
    """Llama a /ready hasta que el sidecar de Agones responda.

    El contenedor del juego y el sidecar del SDK arrancan en paralelo; con el
    nodo cargado el sidecar puede tardar un minuto. Una sola llamada (como en
    el ejemplo del material) falla en silencio y el GameServer se queda en
    Scheduled para siempre. Fuera de Agones nunca responde: se reintenta en
    segundo plano sin afectar al juego. Devuelve el número de intentos.
    """
    intentos = 0
    while True:
        intentos += 1
        if await asyncio.to_thread(agones, "/ready"):
            log.info("Agones: Ready (intento %d)", intentos)
            return intentos
        if intentos == 1:
            log.info("SDK de Agones no disponible todavía; se reintenta /ready cada %.0f s",
                     intervalo)
        await asyncio.sleep(intervalo)


def instalar_sigterm(tarea):
    """Kubernetes detiene el pod con SIGTERM. Python corre como PID 1 en el
    contenedor y, sin manejador, ignora la señal: el pod esperaría los 30 s de
    gracia hasta un SIGKILL. Aquí se cancela el tick y se cierra en orden."""
    import signal
    try:
        asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, tarea.cancel)
    except (NotImplementedError, AttributeError):    # Windows: no hay SIGTERM
        pass


async def main():
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    start_http_server(PUERTO_METRICAS)               # /metrics para Prometheus
    async with websockets.serve(jugador, "0.0.0.0", PUERTO_JUEGO):
        log.info("escuchando en :%d (metricas :%d)", PUERTO_JUEGO, PUERTO_METRICAS)
        ready = asyncio.create_task(anunciar_ready())   # listo para recibir una partida
        tick = asyncio.create_task(bucle())
        instalar_sigterm(tick)
        try:
            await tick
        except asyncio.CancelledError:
            log.info("SIGTERM recibido: cerrando %d conexiones", len(conexiones))
        finally:
            ready.cancel()
    # al salir del "async with" websockets cierra las conexiones abiertas


if __name__ == "__main__":
    asyncio.run(main())
