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

Versión 2 (rediseño del juego), compatible con la 1.2:
- Campos OPCIONALES en el mensaje del jugador: "clase" (interceptor, titan,
  spectre, destroyer, phantom), "hab" (q, e, s), "ax"/"ay" (punto apuntado) y
  "mdx"/"mdy" (dirección de movimiento). Un cliente que no los manda juega con
  la clase por defecto (Spectre), que es exactamente el juego de la 1.2.
- El snapshot agrega "pr" (prórroga) y "z" (zonas de habilidades); los
  proyectiles viajan como eventos en "ev".
- Métricas nuevas: nebula_abilities_total y nebula_projectiles_active.
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

import juego

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
CORRECCIONES = Counter("nebula_position_corrections_total",
                       "Movimientos rechazados por el servidor (velocidad o paredes)")
ESPECTADORES = Gauge("nebula_spectators_connected", "Espectadores conectados al servidor")
HABILIDADES = Counter("nebula_abilities_total", "Habilidades usadas", ["clase", "habilidad"])
PROYECTILES = Gauge("nebula_projectiles_active", "Proyectiles simulados en este momento")
LEADERBOARD_URL = os.getenv("LEADERBOARD_URL", "").rstrip("/")   # 3.5 (opcional)

log = logging.getLogger("nebula")
estado, conexiones, espectadores = {}, set(), set()
partida = {"iniciada": False}
motor = juego.Partida(estado)           # reglas del juego: comparten el dict estado

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


def snapshot(eventos=None, ahora=None):
    """Estado que se envía a todos en cada tick. "t" y "e" son los del material;
    el resto (marcador, tiempo restante, eventos y fin) lo usa el cliente 3D."""
    ahora = time.monotonic() if ahora is None else ahora
    fin = motor.fin and {k: v for k, v in motor.fin.items() if k != "t"}
    return json.dumps({"t": time.time(), "e": estado, "m": motor.marcador,
                       "r": round(motor.tiempo_restante(ahora), 1),
                       "pr": motor.prorroga is not None, "z": motor.zonas_publicas(ahora),
                       "ex": motor.exhibicion,
                       "ev": eventos or [], "fin": fin})


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
    limpio = {"id": jid, "x": float(x), "y": float(y),
              "dispara": d.get("dispara") is True}
    if "dir" in d:                               # ángulo de apuntado (radianes)
        if not _numero(d["dir"]):
            return None
        limpio["dir"] = math.remainder(float(d["dir"]), math.tau)
    nombre = d.get("nombre")
    if isinstance(nombre, str) and nombre.strip():
        limpio["nombre"] = "".join(c for c in nombre.strip() if c.isprintable())[:16]
    # ---- campos opcionales de la versión 2: si vienen mal, el mensaje se descarta
    if "clase" in d:
        if d["clase"] not in juego.CLASES:
            return None
        limpio["clase"] = d["clase"]
    if "hab" in d:
        if d["hab"] not in ("q", "e", "s"):
            return None
        limpio["hab"] = d["hab"]
    for a, b, lim in (("ax", "ay", ARENA), ("mdx", "mdy", 1.0)):
        if a in d or b in d:
            va, vb = d.get(a), d.get(b)
            if not (_numero(va) and _numero(vb)):
                return None
            limpio[a] = min(lim, max(-lim if lim == 1.0 else 0.0, float(va)))
            limpio[b] = min(lim, max(-lim if lim == 1.0 else 0.0, float(vb)))
    return limpio


def _ruta(ws):
    req = getattr(ws, "request", None)              # websockets >= 13
    return getattr(req, "path", None) or getattr(ws, "path", "/") or "/"


async def jugador(ws):
    # Modo espectador (ws://.../espectador): recibe los snapshots sin ocupar lugar.
    if _ruta(ws).rstrip("/").endswith("/espectador"):
        espectadores.add(ws)
        ESPECTADORES.set(len(espectadores))
        try:
            await ws.send(json.dumps({"bienvenida": {"espectador": True, "mapa": juego.mapa(),
                                                     "clases": juego.CLASES}}))
            # Hay que leer lo que mande el espectador: si nadie lee, la cola de entrada
            # se llena (32 mensajes), el keepalive deja de procesarse y la conexión se
            # cae con 1011 al minuto. Solo se contesta el ping de latencia.
            async for msg in ws:
                try:
                    d = json.loads(msg)
                except (ValueError, TypeError):
                    continue
                if isinstance(d, dict) and _numero(d.get("ping")):
                    await ws.send(json.dumps({"pong": d["ping"]}))
        except websockets.ConnectionClosedError:
            pass
        finally:
            espectadores.discard(ws)
            ESPECTADORES.set(len(espectadores))
        return

    if len(conexiones) >= MAX_JUGADORES:
        await ws.close(code=4000, reason="partida llena")
        DESCONEXIONES.labels("partida_llena").inc()
        return
    conexiones.add(ws)
    JUGADORES.set(len(conexiones))
    partida["iniciada"] = True
    mi_id = None
    motivo = "normal"

    async def procesar(msg):
        nonlocal mi_id
        try:
            d = json.loads(msg)
        except (ValueError, TypeError):
            MENSAJES_INVALIDOS.inc()
            return
        if isinstance(d, dict) and "ping" in d:       # latencia: responde al instante
            if _numero(d["ping"]):
                await ws.send(json.dumps({"pong": d["ping"]}))
            else:
                MENSAJES_INVALIDOS.inc()
            return
        limpio = validar(d, mi_id)
        if limpio is None:
            MENSAJES_INVALIDOS.inc()
            return
        ahora = time.monotonic()
        if mi_id is None:
            if limpio["id"] in estado:               # id ocupado por otra conexión
                MENSAJES_INVALIDOS.inc()
                return
            mi_id = limpio["id"]
            yo = motor.unir(mi_id, limpio["x"], limpio["y"], limpio.get("nombre"), ahora,
                            clase=limpio.get("clase"))
            await ws.send(json.dumps({"bienvenida": {
                "id": mi_id, "equipo": yo["equipo"], "x": yo["x"], "y": yo["y"],
                "clase": yo["clase"], "mapa": juego.mapa(), "clases": juego.CLASES}}))
            return
        if "clase" in limpio:
            motor.elegir_clase(mi_id, limpio["clase"])
        correccion = motor.mover(mi_id, limpio["x"], limpio["y"], limpio.get("dir"), ahora)
        if correccion:
            CORRECCIONES.inc()
            await ws.send(json.dumps({"correccion": correccion}))
        if "hab" in limpio:
            info = motor.habilidad(mi_id, limpio["hab"], ahora, limpio.get("ax"), limpio.get("ay"),
                                   limpio.get("mdx"), limpio.get("mdy"))
            if info and info.get("pos"):             # desplazamiento: el servidor movió la nave
                await ws.send(json.dumps({"correccion": info["pos"]}))
        if limpio["dispara"]:
            motor.disparar(mi_id, ahora)

    try:
        async for msg in ws:
            await procesar(msg)
    except websockets.ConnectionClosedError:
        motivo = "error"
    finally:
        conexiones.discard(ws)
        JUGADORES.set(len(conexiones))
        if mi_id is not None:
            motor.salir(mi_id)                       # el jugador sale del estado
        DESCONEXIONES.labels(motivo).inc()


def publicar_resultados(fin):
    """Registra los puntos de los humanos en la tabla de líderes (práctica 3.5).
    Solo si existe LEADERBOARD_URL; la llave viene de SCORE_API_KEY."""
    if not LEADERBOARD_URL:
        return
    for j in fin["jugadores"]:
        if j["bot"]:
            continue
        resultado = ("victoria" if j["equipo"] == fin["ganador"]
                     else "derrota" if fin["ganador"] != "empate" else None)
        nombre = "".join(c for c in j["nombre"] if c.isalnum() or c in "_-")[:32] or "anon"
        cuerpo = {"jugador": nombre, "puntos": j["bajas"] * 100}
        if resultado:
            cuerpo["resultado"] = resultado
        try:
            req = urllib.request.Request(
                f"{LEADERBOARD_URL}/score", data=json.dumps(cuerpo).encode(), method="POST",
                headers={"Content-Type": "application/json",
                         "X-Api-Key": os.getenv("SCORE_API_KEY", "")})
            urllib.request.urlopen(req, timeout=5)
        except Exception as e:
            log.warning("no se pudo registrar el puntaje de %s: %s", nombre, e)


_sdk_pendientes = set()


def _sdk_en_segundo_plano(ruta):
    """Llama al SDK sin frenar el tick. Fuera de Agones (p. ej. en Windows) un
    intento fallido tarda ~2 s; si se esperara aquí, el juego se congelaría."""
    if any(not t.done() for t in _sdk_pendientes):
        return                                   # el anterior sigue en curso
    _sdk_pendientes.clear()
    _sdk_pendientes.add(asyncio.ensure_future(asyncio.to_thread(agones, ruta)))


async def bucle():
    n = 0
    ventana_t, ventana_n = time.perf_counter(), 0
    limite = time.perf_counter()
    while True:
        t = time.perf_counter()
        # tick rate efectivo: ticks iniciados en la ventana / duración de la ventana
        if t - ventana_t >= 2:
            TICK_RATE.set(ventana_n / (t - ventana_t))
            ventana_t, ventana_n = t, 0
        ventana_n += 1
        ahora = time.monotonic()
        # sin humanos pero con espectadores: partida de exhibición solo con bots
        # (no cuenta como partida: no marca "iniciada", no apaga el GameServer y
        # publicar_resultados ignora a los bots)
        if espectadores and not motor.humanos():
            motor.iniciar_exhibicion(ahora)
        elif not espectadores and motor.exhibicion:
            motor.terminar_exhibicion()
        if estado:
            eventos = motor.paso(ahora, TICK_S)
            for clase, hab in motor.usos_habilidad:
                HABILIDADES.labels(clase, hab).inc()
            motor.usos_habilidad.clear()
            PROYECTILES.set(len(motor.proy))
            if any(ev["tipo"] == "fin" for ev in eventos):
                log.info("fin de partida: %s", motor.fin["marcador"])
                asyncio.get_running_loop().run_in_executor(None, publicar_resultados, motor.fin)
        else:
            eventos = []
        if conexiones or espectadores:
            websockets.broadcast(conexiones | espectadores, snapshot(eventos, ahora))
        TICK.observe(time.perf_counter() - t)
        n += 1
        if n % 40 == 0:                              # latido a Agones cada 2 s
            _sdk_en_segundo_plano("/health")
        if partida["iniciada"] and not conexiones:
            log.info("partida terminada: todos los jugadores salieron")
            asyncio.ensure_future(asyncio.to_thread(agones, "/shutdown"))   # fin de partida
            partida["iniciada"] = False
        # agenda contra un reloj absoluto: si una espera se alarga (Windows redondea
        # a ~15 ms), la siguiente se acorta y el promedio se queda en 20 Hz
        limite = max(limite + TICK_S, time.perf_counter() - TICK_S)
        await asyncio.sleep(max(0.0, limite - time.perf_counter()))


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
