"""Orbital Station: el mapa de Nebula Arena (solo lo que importa al servidor).

La simulación es 2D sobre el piso de la estación. Cada obstáculo es un
rectángulo (x, y, ancho, alto) en una arena de 100 x 100; el cliente lo dibuja
en 3D según su tipo. Las alturas, puentes y pasarelas elevadas son decorado del
cliente y no afectan la simulación.

El mapa tiene simetría de ROTACIÓN (180° alrededor del centro), no de espejo:
cada equipo encuentra las mismas coberturas a la misma distancia de su base,
pero la composición no se ve como un reflejo.

Los obstáculos de la versión 1.2 se conservan (las pruebas dependen de ellos);
la versión 2 agrega contenedores, columnas, barreras, consolas y el núcleo.
"""
ARENA = 100.0


def _rotado(x, y, w, h):
    return (ARENA - x - w, ARENA - y - h, w, h)


# (x, y, ancho, alto, tipo). Cada pieza se coloca también rotada 180°.
_MITAD = [
    # --- versión 1.2 (se conservan)
    (20, 20, 4, 14, "muro"),
    (20, 66, 4, 14, "muro"),
    (30, 46, 6, 8, "bloque"),
    (44, 14, 12, 4, "contenedores"),
    (10, 46, 3, 8, "barrera"),
    (38, 28, 4, 4, "pilar"),
    (58, 28, 4, 4, "pilar"),
    # --- versión 2
    (27, 7, 6, 3, "contenedor"),
    (60, 5, 3, 6, "contenedor"),
    (5, 20, 8, 3, "barrera"),
    (32, 62, 3, 10, "muro"),
    (14, 82, 6, 4, "consola"),
    (6, 70, 4, 3, "contenedor"),
    (50, 30, 3, 3, "caja"),
    (24, 36, 6, 2, "barrera"),
    # módulos del núcleo: dejan libre el centro (50, 50), donde el reactor es
    # solo luz en el piso (sin colisión)
    (43, 44, 5, 4, "nucleo"),
]
_CENTRO = []


def _construir():
    piezas = list(_CENTRO)
    for x, y, w, h, tipo in _MITAD:
        piezas.append((x, y, w, h, tipo))
        piezas.append((*_rotado(x, y, w, h), tipo))
    return piezas


PIEZAS = _construir()
OBSTACULOS = [p[:4] for p in PIEZAS]
TIPOS = [p[4] for p in PIEZAS]

APARICIONES = {
    "azul": [(5, 40), (5, 45), (5, 50), (5, 55), (5, 60)],
    "rojo": [(95, 40), (95, 45), (95, 50), (95, 55), (95, 60)],
}

# Posiciones con buena línea de visión y cobertura cercana (las usa la IA del
# Phantom). Lado azul; las del rojo son las rotadas.
_PUESTOS_AZUL = [(17, 10), (17, 89), (9, 33), (26, 58)]
PUESTOS_TIRADOR = {
    "azul": _PUESTOS_AZUL,
    "rojo": [(ARENA - x, ARENA - y) for x, y in _PUESTOS_AZUL],
}
