"""El cliente lleva una copia del mapa y las clases (para el menú y el hangar).
Esta prueba falla si alguien cambia el servidor y no regenera la copia."""
import pathlib
import runpy

import pytest

RAIZ = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = RAIZ / "tools" / "exportar_datos_cliente.py"


@pytest.mark.skipif(not SCRIPT.exists(), reason="fuera del repositorio completo")
def test_copia_del_cliente_coincide_con_el_servidor():
    mod = runpy.run_path(str(SCRIPT))
    actual = (RAIZ / "client" / "src" / "datos-juego.js").read_text(encoding="utf-8")
    assert actual == mod["contenido"](), \
        "Regenera con: python tools/exportar_datos_cliente.py"
