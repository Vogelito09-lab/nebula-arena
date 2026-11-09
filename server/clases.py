"""Las cinco clases de nave. Valores iniciales de balance: se ajustan midiendo
partidas simuladas (ver docs/rediseno-v2.md).

SPECTRE es la clase por defecto: conserva exactamente el arma de la versión 1.2
(disparo instantáneo de 25 de daño cada 0.25 s, 100 de vida, velocidad 12), así
que los clientes que no eligen clase (cliente_prueba.py, Locust, smoke test) y
las pruebas antiguas siguen viendo el mismo juego.

Tipos de arma:
  instantaneo  rayo que se resuelve en el mismo tick (versión 1.2)
  proyectil    objeto simulado por el servidor tick a tick
  railgun      rayo que atraviesa naves enemigas alineadas, pero no paredes

Cada habilidad (q, e, s = Espacio) tiene enfriamiento `cd` en segundos.
"""

CLASE_DEFECTO = "spectre"

CLASES = {
    "interceptor": {
        "nombre": "Interceptor", "rol": "Velocidad y movilidad",
        "vida": 80, "velocidad": 15.0,
        "arma": {"nombre": "Cañones de energía", "tipo": "proyectil", "dano": 14,
                 "cadencia": 0.12, "alcance": 52.0, "vel_proy": 80.0, "radio_proy": 0.25},
        "q": {"nombre": "Impulso extremo", "cd": 10.0, "dur": 3.0, "mult_vel": 1.6,
              "desc": "Aumenta la velocidad un 60 % durante 3 s."},
        "e": {"nombre": "Evasión", "cd": 7.0, "dist": 7.0, "invulnerable": 0.5,
              "desc": "Salto hacia atrás; 0.5 s sin recibir daño."},
        "s": {"nombre": "Propulsión", "cd": 4.0, "dist": 9.0,
              "desc": "Desplazamiento rápido en la dirección de movimiento."},
        "atributos": {"velocidad": 100, "blindaje": 35, "dano": 55, "alcance": 55,
                      "cadencia": 100, "precision": 60},
    },
    "titan": {
        "nombre": "Titan", "rol": "Tanque y resistencia",
        "vida": 200, "velocidad": 9.0,
        "arma": {"nombre": "Cañón pesado de energía", "tipo": "proyectil", "dano": 40,
                 "cadencia": 0.6, "alcance": 50.0, "vel_proy": 45.0, "radio_proy": 0.6},
        "q": {"nombre": "Escudo titánico", "cd": 16.0, "dur": 6.0, "escudo": 100,
              "desc": "Escudo de 100 puntos que absorbe daño durante 6 s."},
        "e": {"nombre": "Fortificación", "cd": 14.0, "dur": 4.0, "reduccion": 0.5,
              "mult_vel": 0.7, "desc": "Recibe 50 % menos daño durante 4 s, pero se mueve más lento."},
        "s": {"nombre": "Embestida", "cd": 6.0, "dist": 5.0,
              "desc": "Desplazamiento corto."},
        "atributos": {"velocidad": 45, "blindaje": 100, "dano": 70, "alcance": 50,
                      "cadencia": 40, "precision": 55},
    },
    "spectre": {
        "nombre": "Spectre", "rol": "Soporte y control",
        "vida": 100, "velocidad": 12.0,
        "arma": {"nombre": "Cañón de pulsos", "tipo": "instantaneo", "dano": 25,
                 "cadencia": 0.25, "alcance": 60.0},
        "q": {"nombre": "Pulso de reparación", "cd": 12.0, "radio": 14.0, "cura": 40,
              "desc": "Repara 40 de blindaje a los aliados cercanos y a sí mismo."},
        "e": {"nombre": "Campo de apoyo", "cd": 18.0, "dur": 6.0, "radio": 10.0,
              "reduccion": 0.3, "cura_s": 6.0,
              "desc": "Zona de 6 s: los aliados dentro reciben 30 % menos daño y se reparan."},
        "s": {"nombre": "Desplazamiento", "cd": 5.0, "dist": 8.0,
              "desc": "Desplazamiento rápido en la dirección de movimiento."},
        "atributos": {"velocidad": 70, "blindaje": 55, "dano": 50, "alcance": 70,
                      "cadencia": 70, "precision": 75},
    },
    "destroyer": {
        "nombre": "Destroyer", "rol": "Daño explosivo",
        "vida": 130, "velocidad": 11.0,
        "arma": {"nombre": "Cañón de asalto", "tipo": "proyectil", "dano": 24,
                 "cadencia": 0.38, "alcance": 55.0, "vel_proy": 55.0, "radio_proy": 0.35,
                 "radio_expl": 3.0, "dano_expl": 10},
        "q": {"nombre": "Bombardeo", "cd": 14.0, "alcance": 38.0, "radio": 7.0,
              "dano": 55, "retardo": 1.0,
              "desc": "Ataque explosivo sobre la zona apuntada (cae 1 s después)."},
        "e": {"nombre": "Misiles tácticos", "cd": 12.0, "cantidad": 4, "dano": 22,
              "alcance": 42.0, "vel_proy": 40.0,
              "desc": "Ráfaga de 4 misiles contra los enemigos visibles."},
        "s": {"nombre": "Propulsión", "cd": 6.0, "dist": 6.0,
              "desc": "Desplazamiento corto."},
        "atributos": {"velocidad": 60, "blindaje": 70, "dano": 90, "alcance": 60,
                      "cadencia": 55, "precision": 50},
    },
    "phantom": {
        "nombre": "Phantom", "rol": "Precisión y largo alcance",
        "vida": 70, "velocidad": 10.0,
        "arma": {"nombre": "Railgun", "tipo": "railgun", "dano": 60,
                 "cadencia": 1.4, "alcance": 95.0},
        "q": {"nombre": "Disparo de precisión", "cd": 9.0, "carga_max": 2.0,
              "dano_extra": 70, "mult_vel": 0.6, "max_espera": 4.0,
              "desc": "Carga el railgun hasta 2 s: hasta 70 de daño extra. Se mueve más lento mientras carga."},
        "e": {"nombre": "Camuflaje óptico", "cd": 16.0, "dur": 6.0,
              "desc": "Casi invisible 6 s. No puede disparar; recibir daño lo revela."},
        "s": {"nombre": "Desplazamiento táctico", "cd": 5.0, "dist": 8.0,
              "desc": "Impulso corto para cambiar de posición."},
        "atributos": {"velocidad": 55, "blindaje": 40, "dano": 95, "alcance": 100,
                      "cadencia": 25, "precision": 100},
    },
}

# Orden en que los bots ocupan los lugares libres de cada equipo.
ORDEN_BOTS = ["titan", "interceptor", "destroyer", "phantom", "spectre"]


def clase(nombre):
    """Configuración de una clase; la de defecto si el nombre no existe."""
    return CLASES.get(nombre) or CLASES[CLASE_DEFECTO]


def catalogo():
    """Lo que el cliente necesita para el hangar y el HUD."""
    return CLASES
