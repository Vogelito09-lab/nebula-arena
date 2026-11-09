"""Pruebas de la tabla de líderes de AWS con una tabla DynamoDB falsa en memoria.

Los casos son los mismos que serverless/tests/test_main.py (versión Cloud Run),
para demostrar que las dos versiones responden igual.
"""
import json
from decimal import Decimal

import pytest

import lambda_function as lf


class TablaFalsa:
    """Imita update_item (ADD), get_item y scan paginado de DynamoDB."""

    def __init__(self, pagina=4):
        self.items, self.pagina = {}, pagina

    def update_item(self, Key, UpdateExpression, ExpressionAttributeValues):
        assert UpdateExpression.startswith("ADD ")
        item = self.items.setdefault(Key["jugador"], {"jugador": Key["jugador"]})
        for parte in UpdateExpression[4:].split(","):
            campo, valor = parte.split()
            item[campo] = item.get(campo, Decimal(0)) + ExpressionAttributeValues[valor]

    def get_item(self, Key):
        item = self.items.get(Key["jugador"])
        return {"Item": dict(item)} if item else {}

    def scan(self, ExclusiveStartKey=None):
        llaves = sorted(self.items)
        inicio = llaves.index(ExclusiveStartKey["jugador"]) + 1 if ExclusiveStartKey else 0
        trozo = llaves[inicio:inicio + self.pagina]
        r = {"Items": [dict(self.items[k]) for k in trozo]}
        if inicio + self.pagina < len(llaves):
            r["LastEvaluatedKey"] = {"jugador": trozo[-1]}
        return r


def evento(metodo, ruta, cuerpo=None, cabeceras=None, base64=False):
    e = {"rawPath": ruta, "requestContext": {"http": {"method": metodo}},
         "headers": cabeceras or {}}
    if cuerpo is not None:
        texto = cuerpo if isinstance(cuerpo, str) else json.dumps(cuerpo)
        if base64:
            import base64 as b64
            texto, e["isBase64Encoded"] = b64.b64encode(texto.encode()).decode(), True
        e["body"] = texto
    if ruta.startswith("/jugador/"):
        e["pathParameters"] = {"jugador": ruta[len("/jugador/"):]}
    return e


@pytest.fixture
def llamar(monkeypatch):
    monkeypatch.setattr(lf, "_tabla", TablaFalsa())
    monkeypatch.setattr(lf, "_llave", None)
    monkeypatch.setattr(lf, "_cache_top", None)
    monkeypatch.setattr(lf, "CACHE_TOP_S", 0)     # sin caché, salvo en su prueba
    monkeypatch.delenv("SCORE_API_KEY", raising=False)
    monkeypatch.delenv("SCORE_API_KEY_PARAM", raising=False)

    def _llamar(*a, **k):
        r = lf.lambda_handler(evento(*a, **k), None)
        cuerpo = r["body"]
        if r["headers"]["Content-Type"] == "application/json":
            cuerpo = json.loads(cuerpo)
        return r["statusCode"], cuerpo
    return _llamar


def test_registrar_y_consultar_top(llamar):
    assert llamar("POST", "/score", {"jugador": "ana", "puntos": 1250, "resultado": "victoria"})[0] == 201
    assert llamar("POST", "/score", {"jugador": "beto", "puntos": 900, "resultado": "derrota"})[0] == 201
    assert llamar("POST", "/score", {"jugador": "ana", "puntos": 300, "resultado": "derrota"})[0] == 201
    codigo, top = llamar("GET", "/top")
    assert codigo == 200
    assert top[0] == {"posicion": 1, "jugador": "ana", "puntos": 1550, "partidas": 2, "victorias": 1, "derrotas": 1}
    assert top[1] == {"posicion": 2, "jugador": "beto", "puntos": 900, "partidas": 1, "victorias": 0, "derrotas": 1}


def test_formato_del_material_sin_resultado(llamar):
    assert llamar("POST", "/score", {"jugador": "ana", "puntos": 1250})[0] == 201
    assert llamar("GET", "/top")[1][0]["puntos"] == 1250


def test_cuerpo_en_base64(llamar):
    # API Gateway puede mandar el cuerpo codificado en base64
    assert llamar("POST", "/score", {"jugador": "ana", "puntos": 7}, base64=True)[0] == 201
    assert llamar("GET", "/jugador/ana")[1]["puntos"] == 7


def test_top_limita_a_10_y_recorre_todas_las_paginas(llamar):
    for i in range(15):
        llamar("POST", "/score", {"jugador": f"j{i:02d}", "puntos": i})
    top = llamar("GET", "/top")[1]
    assert len(top) == 10 and top[0]["jugador"] == "j14" and top[-1]["posicion"] == 10


@pytest.mark.parametrize("cuerpo", [
    {"puntos": 10},
    {"jugador": "", "puntos": 10},
    {"jugador": "a b", "puntos": 10},
    {"jugador": "x" * 33, "puntos": 10},
    {"jugador": "ana", "puntos": -5},
    {"jugador": "ana", "puntos": 10.5},
    {"jugador": "ana", "puntos": "10"},
    {"jugador": "ana", "puntos": True},
    {"jugador": "ana", "puntos": 10_000_000},
    {"jugador": "ana", "puntos": 10, "resultado": "empate"},
])
def test_valida_entradas(llamar, cuerpo):
    assert llamar("POST", "/score", cuerpo)[0] == 400


def test_cuerpo_no_json(llamar):
    assert llamar("POST", "/score", "hola")[0] == 400


def test_api_key_protege_escrituras(llamar, monkeypatch):
    monkeypatch.setenv("SCORE_API_KEY", "llave-de-prueba")
    cuerpo = {"jugador": "ana", "puntos": 10}
    assert llamar("POST", "/score", cuerpo)[0] == 401
    assert llamar("POST", "/score", cuerpo, {"X-Api-Key": "otra"})[0] == 401
    # API Gateway entrega las cabeceras en minúsculas
    assert llamar("POST", "/score", cuerpo, {"x-api-key": "llave-de-prueba"})[0] == 201
    assert llamar("GET", "/top")[0] == 200          # leer no requiere llave


def test_estadisticas_de_jugador(llamar):
    llamar("POST", "/score", {"jugador": "ana", "puntos": 40, "resultado": "victoria"})
    assert llamar("GET", "/jugador/ana")[1]["victorias"] == 1
    assert llamar("GET", "/jugador/nadie")[0] == 404
    assert llamar("GET", "/jugador/a b")[0] == 400


def test_salud_y_ruta_desconocida(llamar):
    assert llamar("GET", "/healthz") == (200, "ok")
    assert llamar("GET", "/nada")[0] == 404


def test_cache_del_top(llamar, monkeypatch):
    """Con caché, /top no vuelve a leer la tabla hasta que pasan CACHE_TOP_S."""
    monkeypatch.setattr(lf, "CACHE_TOP_S", 2)
    reloj = [100.0]
    monkeypatch.setattr(lf.time, "monotonic", lambda: reloj[0])
    lecturas = []
    original = lf._tabla.scan
    monkeypatch.setattr(lf._tabla, "scan", lambda **k: lecturas.append(1) or original(**k))

    llamar("POST", "/score", {"jugador": "ana", "puntos": 10})
    assert llamar("GET", "/top")[1][0]["puntos"] == 10
    llamar("POST", "/score", {"jugador": "ana", "puntos": 5})
    reloj[0] += 1.5                                   # dentro de la ventana: misma respuesta
    assert llamar("GET", "/top")[1][0]["puntos"] == 10 and len(lecturas) == 1
    reloj[0] += 1.0                                   # ventana vencida: vuelve a leer
    assert llamar("GET", "/top")[1][0]["puntos"] == 15 and len(lecturas) == 2


def test_error_interno_no_filtra_detalles(llamar, monkeypatch):
    class Rota:
        def scan(self, **_):
            raise RuntimeError("detalle secreto")
    monkeypatch.setattr(lf, "_tabla", Rota())
    codigo, cuerpo = llamar("GET", "/top")
    assert codigo == 500 and "secreto" not in json.dumps(cuerpo)
