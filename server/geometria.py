"""Geometría 2D del plano de la estación: colisiones, rayos y línea de visión."""
import math

from estacion import ARENA, OBSTACULOS

RADIO = 1.0                       # radio de colisión de una nave
ALCANCE = 60.0                    # alcance por defecto de un rayo


def choca(x, y, r=RADIO):
    """True si un círculo en (x, y) se sale de la arena o toca un obstáculo."""
    if x < r or y < r or x > ARENA - r or y > ARENA - r:
        return True
    for ox, oy, w, h in OBSTACULOS:
        cx, cy = min(max(x, ox), ox + w), min(max(y, oy), oy + h)
        if (x - cx) ** 2 + (y - cy) ** 2 < r * r:
            return True
    return False


def _rayo_caja(x, y, dx, dy, caja):
    """Distancia a la que el rayo entra en la caja, o None."""
    ox, oy, w, h = caja
    tmin, tmax = 0.0, math.inf
    for p, d, lo, hi in ((x, dx, ox, ox + w), (y, dy, oy, oy + h)):
        if abs(d) < 1e-9:
            if p < lo or p > hi:
                return None
        else:
            t1, t2 = (lo - p) / d, (hi - p) / d
            tmin, tmax = max(tmin, min(t1, t2)), min(tmax, max(t1, t2))
            if tmin > tmax:
                return None
    return tmin


def _cerca(x0, y0, x1, y1, m=0.0):
    """Obstáculos cuya caja toca la caja envolvente del segmento (descarte rápido)."""
    lx, hx = (x0, x1) if x0 < x1 else (x1, x0)
    ly, hy = (y0, y1) if y0 < y1 else (y1, y0)
    lx, ly, hx, hy = lx - m, ly - m, hx + m, hy + m
    return [c for c in OBSTACULOS
            if c[0] <= hx and c[0] + c[2] >= lx and c[1] <= hy and c[1] + c[3] >= ly]


def distancia_a_pared(x, y, dx, dy, alcance=ALCANCE):
    """Distancia hasta el primer obstáculo en la dirección (dx, dy), máximo alcance."""
    d = alcance
    for caja in _cerca(x, y, x + dx * alcance, y + dy * alcance):
        t = _rayo_caja(x, y, dx, dy, caja)
        if t is not None and t < d:
            d = t
    return d


def distancia_a_borde(x, y, dx, dy):
    """Distancia hasta salir de la arena."""
    d = math.inf
    for p, v in ((x, dx), (y, dy)):
        if v > 1e-9:
            d = min(d, (ARENA - p) / v)
        elif v < -1e-9:
            d = min(d, -p / v)
    return max(d, 0.0)


def rayo_circulo(x, y, dx, dy, cx, cy, r=RADIO):
    """Distancia a la que el rayo toca el círculo (0 si empieza dentro), o None."""
    fx, fy = x - cx, y - cy
    c = fx * fx + fy * fy - r * r
    if c <= 0:
        return 0.0
    b = fx * dx + fy * dy
    disc = b * b - c
    if disc < 0:
        return None
    t = -b - math.sqrt(disc)
    return t if t >= 0 else None


def _rayo_circulo(x, y, dx, dy, cx, cy, r=RADIO):
    """Versión 1.2 (no cuenta el caso de empezar dentro). Se conserva por compatibilidad."""
    fx, fy = x - cx, y - cy
    b = fx * dx + fy * dy
    c = fx * fx + fy * fy - r * r
    disc = b * b - c
    if disc < 0:
        return None
    t = -b - math.sqrt(disc)
    return t if t >= 0 else None


def hay_vision(a, b):
    """Línea de visión entre dos entidades (las paredes la cortan)."""
    return vision_entre(a["x"], a["y"], b["x"], b["y"])


def vision_entre(x0, y0, x1, y1):
    dx, dy = x1 - x0, y1 - y0
    dist = math.hypot(dx, dy)
    if dist < 1e-6:
        return True
    return distancia_a_pared(x0, y0, dx / dist, dy / dist, dist) >= dist


def camino_libre(x0, y0, x1, y1, r=RADIO):
    """True si una nave de radio r puede ir en línea recta de un punto al otro.

    Segmento contra cada obstáculo ensanchado r por lado (suma de Minkowski con
    esquinas cuadradas: un poco conservador en las esquinas, nunca permisivo).
    Una operación por obstáculo en lugar de muestrear el trayecto."""
    for x, y in ((x0, y0), (x1, y1)):
        if x < r or y < r or x > ARENA - r or y > ARENA - r:
            return False
    dx, dy = x1 - x0, y1 - y0
    dist = math.hypot(dx, dy)
    if dist < 1e-9:
        return not choca(x0, y0, r)
    dx, dy = dx / dist, dy / dist
    for ox, oy, w, h in _cerca(x0, y0, x1, y1, r):
        t = _rayo_caja(x0, y0, dx, dy, (ox - r, oy - r, w + 2 * r, h + 2 * r))
        if t is not None and t <= dist:
            return False
    return True


def deslizar_hasta(x, y, dx, dy, distancia, r=RADIO, paso=0.25):
    """Avanza en línea recta hasta `distancia` o hasta antes de chocar.
    Lo usan los desplazamientos (Espacio, evasión)."""
    n = math.hypot(dx, dy)
    if n < 1e-9:
        return x, y
    dx, dy = dx / n, dy / n
    recorrido = 0.0
    while recorrido + paso <= distancia:
        nx, ny = x + dx * paso, y + dy * paso
        if choca(nx, ny, r):
            break
        x, y = nx, ny
        recorrido += paso
    return x, y
