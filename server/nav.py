"""Navegación de los bots: A* sobre una cuadrícula de la estación.

La cuadrícula (celdas de 2 x 2) se calcula una vez. Una celda es transitable si
una nave cabe en su centro con margen. El camino se suaviza quitando puntos
intermedios cuando hay paso en línea recta.
"""
import heapq
import math

from estacion import ARENA
from geometria import RADIO, camino_libre, choca

CELDA = 2.0
N = int(ARENA / CELDA)
MAX_EXPANSIONES = 900             # tope de trabajo por búsqueda (protege el tick)
PESO_H = 1.3                      # A* ponderado: un poco menos óptimo, mucho más rápido
_VECINOS = [(1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0),
            (1, 1, 1.414), (1, -1, 1.414), (-1, 1, 1.414), (-1, -1, 1.414)]


def _centro(i, j):
    return (i + 0.5) * CELDA, (j + 0.5) * CELDA


LIBRE = [[not choca(*_centro(i, j), RADIO * 1.25) for j in range(N)] for i in range(N)]


def _celda(x, y):
    return (min(N - 1, max(0, int(x / CELDA))), min(N - 1, max(0, int(y / CELDA))))


def _libre_cercana(c):
    """La celda transitable más cercana (por si el punto cae junto a una pared)."""
    if LIBRE[c[0]][c[1]]:
        return c
    for r in range(1, 6):
        for di in range(-r, r + 1):
            for dj in range(-r, r + 1):
                i, j = c[0] + di, c[1] + dj
                if 0 <= i < N and 0 <= j < N and LIBRE[i][j]:
                    return (i, j)
    return c


def ruta(x0, y0, x1, y1):
    """Lista de puntos (x, y) desde cerca del origen hasta el destino, o [] si no hay."""
    if camino_libre(x0, y0, x1, y1):
        return [(x1, y1)]
    ini, fin = _libre_cercana(_celda(x0, y0)), _libre_cercana(_celda(x1, y1))
    abiertos = [(0.0, ini)]
    costo = {ini: 0.0}
    padre = {}
    expansiones = 0
    while abiertos:
        _, act = heapq.heappop(abiertos)
        if act == fin:
            break
        expansiones += 1
        if expansiones > MAX_EXPANSIONES:
            return []
        for di, dj, c in _VECINOS:
            i, j = act[0] + di, act[1] + dj
            if not (0 <= i < N and 0 <= j < N) or not LIBRE[i][j]:
                continue
            if di and dj and not (LIBRE[act[0] + di][act[1]] and LIBRE[act[0]][act[1] + dj]):
                continue                              # no cortar esquinas
            nuevo = costo[act] + c
            if nuevo < costo.get((i, j), math.inf):
                costo[(i, j)] = nuevo
                padre[(i, j)] = act
                h = math.hypot(fin[0] - i, fin[1] - j)
                heapq.heappush(abiertos, (nuevo + PESO_H * h, (i, j)))
    if fin not in costo:
        return []
    celdas = [fin]
    while celdas[-1] != ini:
        celdas.append(padre[celdas[-1]])
    puntos = [_centro(*c) for c in reversed(celdas)][1:] + [(x1, y1)]
    return _suavizar(x0, y0, puntos)


def _suavizar(x0, y0, puntos):
    salida, ax, ay, k = [], x0, y0, 0
    while k < len(puntos):
        lejos = k
        for m in range(min(len(puntos) - 1, k + 12), k, -1):   # ventana: acota el costo
            if camino_libre(ax, ay, *puntos[m]):
                lejos = m
                break
        salida.append(puntos[lejos])
        ax, ay = puntos[lejos]
        k = lejos + 1
    return salida
