"""Práctica 3.5 (variante AWS): tabla de líderes con Lambda + API Gateway + DynamoDB.

Basada en la "Opción AWS" del material (tabla DynamoDB nebula-scores con llave
de partición jugador, ADD puntos/partidas, scan para el top). Responde los
mismos endpoints que la versión de Cloud Run (serverless/main.py), así el
servidor del juego, el cliente y Locust funcionan sin cambios:

  POST /score  {"jugador": "ana", "puntos": 1250, "resultado": "victoria"}
  GET  /top                 top 10 global
  GET  /jugador/{jugador}   estadísticas de un jugador
  GET  /healthz

API Gateway (HTTP API, formato de evento 2.0) manda todas las rutas a esta
función.

Seguridad:
  - Validación de entradas, igual que la versión de Cloud Run.
  - POST /score exige la cabecera X-Api-Key si la función tiene configurada
    una llave. La llave vive en SSM Parameter Store (SecureString), nunca en el
    código ni en el estado de Terraform; la función solo conoce el NOMBRE del
    parámetro (variable SCORE_API_KEY_PARAM).
"""
import base64
import hmac
import json
import logging
import os
import re
import time
from decimal import Decimal

ID_VALIDO = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
MAX_PUNTOS = 100_000
TOP_N = 10
CAMPOS = ("puntos", "partidas", "victorias", "derrotas")
CACHE_TOP_S = float(os.environ.get("CACHE_TOP_S", "2"))

log = logging.getLogger()
log.setLevel(logging.INFO)

_tabla = None
_llave = None          # se lee una vez por contenedor (arranque en frío)
_cache_top = None      # (momento, top) del último cálculo en este contenedor


def tabla():
    """Tabla de DynamoDB creada al primer uso (las pruebas la sustituyen)."""
    global _tabla
    if _tabla is None:
        import boto3
        _tabla = boto3.resource("dynamodb").Table(os.environ.get("TABLA", "nebula-scores"))
    return _tabla


def llave_api():
    """Llave de POST /score: SCORE_API_KEY directa o el parámetro SSM indicado."""
    global _llave
    if _llave is None:
        if os.environ.get("SCORE_API_KEY"):
            _llave = os.environ["SCORE_API_KEY"]
        elif os.environ.get("SCORE_API_KEY_PARAM"):
            import boto3
            _llave = boto3.client("ssm").get_parameter(
                Name=os.environ["SCORE_API_KEY_PARAM"], WithDecryption=True)["Parameter"]["Value"]
        else:
            _llave = ""
    return _llave


def _resp(codigo, cuerpo):
    if isinstance(cuerpo, str):
        return {"statusCode": codigo, "headers": {"Content-Type": "text/plain"}, "body": cuerpo}
    return {"statusCode": codigo, "headers": {"Content-Type": "application/json"},
            "body": json.dumps(cuerpo, ensure_ascii=False)}


def _fila(jugador, d):
    return {"jugador": jugador, **{c: int(d.get(c, 0)) for c in CAMPOS}}


def _guardar(event):
    llave = llave_api()
    if llave:
        cabeceras = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
        if not hmac.compare_digest(cabeceras.get("x-api-key", ""), llave):
            return _resp(401, {"error": "no autorizado"})
    cuerpo = event.get("body") or ""
    if event.get("isBase64Encoded"):
        cuerpo = base64.b64decode(cuerpo).decode("utf-8", "replace")
    try:
        d = json.loads(cuerpo)
    except ValueError:
        d = None
    if not isinstance(d, dict):
        return _resp(400, {"error": "se esperaba un objeto JSON"})
    jugador, puntos, resultado = d.get("jugador"), d.get("puntos"), d.get("resultado")
    if not isinstance(jugador, str) or not ID_VALIDO.match(jugador):
        return _resp(400, {"error": "'jugador': 1-32 caracteres (letras, números, _ o -)"})
    if not isinstance(puntos, int) or isinstance(puntos, bool) or not 0 <= puntos <= MAX_PUNTOS:
        return _resp(400, {"error": f"'puntos': entero entre 0 y {MAX_PUNTOS}"})
    if resultado not in (None, "victoria", "derrota"):
        return _resp(400, {"error": "'resultado': 'victoria' o 'derrota'"})
    expresion, valores = "ADD puntos :p, partidas :uno", {":p": Decimal(puntos), ":uno": Decimal(1)}
    if resultado == "victoria":
        expresion += ", victorias :uno"
    elif resultado == "derrota":
        expresion += ", derrotas :uno"
    tabla().update_item(Key={"jugador": jugador}, UpdateExpression=expresion,
                        ExpressionAttributeValues=valores)
    return _resp(201, "ok")


def _top():
    """Top 10 con caché en memoria de CACHE_TOP_S segundos.

    Hallazgo de la prueba de carga (500 usuarios): cada GET /top hacía un scan
    completo (~50 ms) y la cuenta nueva solo permite 10 Lambdas a la vez, así
    que el 92 % de las peticiones se rechazaron. Con la caché, el contenedor
    reutiliza el top calculado hace menos de 2 s y responde en ~1 ms.
    Un top con 2 s de retraso es aceptable para una tabla de líderes.
    """
    global _cache_top
    ahora = time.monotonic()
    if _cache_top and ahora - _cache_top[0] < CACHE_TOP_S:
        return _resp(200, _cache_top[1])
    top = _calcular_top()
    _cache_top = (ahora, top)
    return _resp(200, top)


def _calcular_top():
    # scan sirve para la práctica (lo dice el material); en producción se usaría
    # un índice ordenado por puntos o Redis con sorted sets.
    items, args = [], {}
    while True:
        r = tabla().scan(**args)
        items += r.get("Items", [])
        if "LastEvaluatedKey" not in r:
            break
        args["ExclusiveStartKey"] = r["LastEvaluatedKey"]
    items.sort(key=lambda i: i.get("puntos", 0), reverse=True)
    return [{"posicion": n, **_fila(i["jugador"], i)} for n, i in enumerate(items[:TOP_N], 1)]


def _jugador(jugador):
    if not ID_VALIDO.match(jugador or ""):
        return _resp(400, {"error": "id de jugador inválido"})
    item = tabla().get_item(Key={"jugador": jugador}).get("Item")
    if item is None:
        return _resp(404, {"error": "jugador no encontrado"})
    return _resp(200, _fila(jugador, item))


def lambda_handler(event, context):
    metodo = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    ruta = event.get("rawPath", "/")
    try:
        if metodo == "POST" and ruta == "/score":
            return _guardar(event)
        if metodo == "GET" and ruta == "/top":
            return _top()
        if metodo == "GET" and ruta.startswith("/jugador/"):
            return _jugador((event.get("pathParameters") or {}).get("jugador")
                            or ruta[len("/jugador/"):])
        if metodo == "GET" and ruta == "/healthz":
            return _resp(200, "ok")
        return _resp(404, {"error": "ruta no encontrada"})
    except Exception:
        log.exception("error no controlado")
        return _resp(500, {"error": "error interno"})
