"""Pruebas de la tabla de líderes con un Firestore falso en memoria.

El falso imita lo que usa main.py: collection().document().set(merge=True)
con firestore.Increment, .get(), order_by().limit().stream().
"""
import pytest
from google.cloud import firestore

import main


class Doc:
    def __init__(self, id, datos):
        self.id, self._d = id, datos

    @property
    def exists(self):
        return self._d is not None

    def to_dict(self):
        return dict(self._d) if self._d is not None else None


class RefDoc:
    def __init__(self, tabla, id):
        self.tabla, self.id = tabla, id

    def set(self, cambios, merge=False):
        actual = self.tabla.setdefault(self.id, {}) if merge else {}
        for k, v in cambios.items():
            actual[k] = actual.get(k, 0) + v.value if isinstance(v, firestore.Increment) else v
        self.tabla[self.id] = actual

    def get(self):
        return Doc(self.id, self.tabla.get(self.id))


class Consulta:
    def __init__(self, tabla, campo=None, desc=False, n=None):
        self.tabla, self.campo, self.desc, self.n = tabla, campo, desc, n

    def order_by(self, campo, direction=None):
        return Consulta(self.tabla, campo, direction == firestore.Query.DESCENDING, self.n)

    def limit(self, n):
        return Consulta(self.tabla, self.campo, self.desc, n)

    def stream(self):
        filas = sorted(self.tabla.items(), key=lambda kv: kv[1].get(self.campo, 0), reverse=self.desc)
        return [Doc(k, v) for k, v in filas[: self.n]]


class Coleccion(Consulta):
    def document(self, id):
        return RefDoc(self.tabla, id)


class FakeDB:
    def __init__(self):
        self.tablas = {}

    def collection(self, nombre):
        return Coleccion(self.tablas.setdefault(nombre, {}))


@pytest.fixture
def cliente(monkeypatch):
    monkeypatch.setattr(main, "_db", FakeDB())
    monkeypatch.delenv("SCORE_API_KEY", raising=False)
    main.app.config["TESTING"] = True
    return main.app.test_client()


def test_registrar_y_consultar_top(cliente):
    assert cliente.post("/score", json={"jugador": "ana", "puntos": 1250, "resultado": "victoria"}).status_code == 201
    assert cliente.post("/score", json={"jugador": "beto", "puntos": 900, "resultado": "derrota"}).status_code == 201
    assert cliente.post("/score", json={"jugador": "ana", "puntos": 300, "resultado": "derrota"}).status_code == 201
    top = cliente.get("/top").get_json()
    assert top[0] == {"posicion": 1, "jugador": "ana", "puntos": 1550, "partidas": 2, "victorias": 1, "derrotas": 1}
    assert top[1] == {"posicion": 2, "jugador": "beto", "puntos": 900, "partidas": 1, "victorias": 0, "derrotas": 1}


def test_formato_del_material_sin_resultado(cliente):
    # el curl del material: {"jugador":"ana","puntos":1250}
    assert cliente.post("/score", json={"jugador": "ana", "puntos": 1250}).status_code == 201
    assert cliente.get("/top").get_json()[0]["puntos"] == 1250


def test_top_limita_a_10(cliente):
    for i in range(15):
        cliente.post("/score", json={"jugador": f"j{i}", "puntos": i})
    top = cliente.get("/top").get_json()
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
def test_valida_entradas(cliente, cuerpo):
    assert cliente.post("/score", json=cuerpo).status_code == 400


def test_cuerpo_no_json(cliente):
    assert cliente.post("/score", data="hola").status_code == 400


def test_api_key_protege_escrituras(cliente, monkeypatch):
    monkeypatch.setenv("SCORE_API_KEY", "llave-de-prueba")
    cuerpo = {"jugador": "ana", "puntos": 10}
    assert cliente.post("/score", json=cuerpo).status_code == 401
    assert cliente.post("/score", json=cuerpo, headers={"X-Api-Key": "otra"}).status_code == 401
    assert cliente.post("/score", json=cuerpo, headers={"X-Api-Key": "llave-de-prueba"}).status_code == 201
    assert cliente.get("/top").status_code == 200          # leer no requiere llave


def test_estadisticas_de_jugador(cliente):
    cliente.post("/score", json={"jugador": "ana", "puntos": 40, "resultado": "victoria"})
    assert cliente.get("/jugador/ana").get_json()["victorias"] == 1
    assert cliente.get("/jugador/nadie").status_code == 404
    assert cliente.get("/jugador/a%20b").status_code == 400
