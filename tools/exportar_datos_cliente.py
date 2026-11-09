"""Genera client/src/datos-juego.js a partir del servidor (fuente de verdad).

El cliente necesita el mapa y las clases antes de conectarse (menú y hangar).
Uso:  .venv/Scripts/python tools/exportar_datos_cliente.py
La prueba server/tests/test_datos_cliente.py falla si el archivo quedó viejo.
"""
import json
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "server"))

import juego  # noqa: E402

DESTINO = RAIZ / "client" / "src" / "datos-juego.js"


def contenido():
    datos = {"mapa": juego.mapa(), "clases": juego.CLASES, "clase_defecto": juego.CLASE_DEFECTO}
    return ("// Generado por tools/exportar_datos_cliente.py desde el servidor. No editar a mano.\n"
            f"export const DATOS = {json.dumps(datos, ensure_ascii=False, indent=1)};\n"
            "export const MAPA = DATOS.mapa;\n"
            "export const CLASES = DATOS.clases;\n"
            "export const CLASE_DEFECTO = DATOS.clase_defecto;\n")


if __name__ == "__main__":
    DESTINO.write_text(contenido(), encoding="utf-8")
    print("escrito", DESTINO)
