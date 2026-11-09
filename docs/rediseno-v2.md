# Rediseño V2 del juego

El juego no lo califica la rúbrica (90 % es infraestructura), pero es el caso de
estudio: tiene que verse y jugarse como un juego real **sin romper nada de la
infraestructura** (ver [inventario-protegido.md](inventario-protegido.md)).

## Qué cambió

| Área | Versión 1.2 | Versión 2 |
|---|---|---|
| Vista | Cámara en perspectiva detrás de la nave | Cámara **isométrica ortográfica** (48°), sigue al piloto con adelanto hacia el mouse; las paredes que tapan una nave se vuelven transparentes |
| Mapa | Arena con 14 obstáculos | **Orbital Station**: 32 piezas simétricas (muros, contenedores, barreras, pilares, consolas, cajas, núcleos), pasarelas elevadas decorativas. La simulación sigue en 2D; las alturas son solo visuales |
| Naves | Una sola | **5 clases** con modelos procedurales (sin archivos externos): Interceptor, Titan, Spectre, Destroyer, Phantom |
| Armas | Rayo instantáneo | Instantáneo (Spectre), **proyectiles simulados por el servidor** (Interceptor, Titan, Destroyer, misiles), **railgun** que atraviesa naves pero no paredes (Phantom) |
| Habilidades | — | Q, E y Espacio por clase; el servidor valida enfriamientos y efectos |
| Reglas | 25 bajas o 5 min (la 2.0 sube la meta a 50) | + **asistencias** (daño en los 5 s previos) y **prórroga** (empate a los 5 min → la siguiente baja gana, máx. 60 s, si no, empate) |
| Bots | Patrullar / perseguir / retirarse | Máquina de estados PATROL, ATTACK, DEFEND, SUPPORT, RETREAT, RESPAWN con rutas A* (ver abajo) |
| Interfaz | HUD simple | HUD militar, menú con hangar 3D, hangar de naves, ajustes, estadísticas locales, pantalla de destrucción con cambio de clase, menú ESC que **no pausa** |
| Audio | — | Efectos y música 100 % procedurales con Web Audio, volúmenes separados |
| Gráficos | Uno | Perfiles **BAJO** (75 % de resolución, sin sombras ni bloom, 40 % de partículas) y **ALTO** |

## Exhibición para espectadores

Sin humanos no hay partida (el reloj y los bots arrancan con el primer piloto),
así que un espectador veía la arena quieta. Ahora, si hay espectadores y ningún
humano, el servidor corre una **exhibición solo de bots** (`Partida.iniciar_exhibicion`).
En cuanto entra un humano se descarta y empieza una partida real desde cero; si
se van todos los espectadores, los bots se quitan. La exhibición no marca la
partida como iniciada, así que **no apaga el GameServer** (`/shutdown` de Agones
sigue igual), y `publicar_resultados` ignora a los bots: no escribe en la tabla de
líderes. Solo gasta CPU mientras alguien la mira. El snapshot la indica con
`"ex": true` (campo nuevo y opcional). 6 pruebas en `tests/test_exhibicion.py`.

## Clases (valores iniciales de balance)

| Clase | Vida | Vel. | Arma | Q | E | Espacio |
|---|---|---|---|---|---|---|
| Interceptor | 80 | 15 | Proyectil 14 de daño cada 0.12 s | Impulso ×1.6 por 3 s (cd 10) | Evasión hacia atrás + 0.5 s invulnerable (cd 7) | Propulsión 9 u (cd 4) |
| Titan | 200 | 9 | Proyectil pesado 40 cada 0.6 s | Escudo de 100 por 6 s (cd 16) | Fortificación −50 % daño, −30 % velocidad, 4 s (cd 14) | 5 u (cd 6) |
| **Spectre** (defecto) | 100 | 12 | **Rayo instantáneo 25 cada 0.25 s (el de la 1.2)** | Pulso de reparación +40 en radio 14 (cd 12) | Campo de apoyo: −30 % daño y +6 PV/s, 6 s (cd 18) | 8 u (cd 5) |
| Destroyer | 130 | 11 | Proyectil 24 + explosión 10 (radio 3) | Bombardeo: 55 de daño en radio 7 tras 1 s, alcance 38 (cd 14) | 4 misiles de 22 a enemigos visibles (cd 12) | 6 u (cd 6) |
| Phantom | 70 | 10 | Railgun 60 cada 1.4 s, alcance 95, atraviesa naves | Disparo cargado: hasta +70 en 2 s, se mueve al 60 % (cd 9, empieza al disparar) | Camuflaje 6 s: no puede disparar, el daño lo revela (cd 16) | 8 u (cd 5) |

Sin munición ni definitiva. Los valores salen de `server/clases.py` (fuente de
verdad); el cliente los recibe del servidor y `tools/exportar_datos_cliente.py`
genera la copia para el menú (`client/src/datos-juego.js`; una prueba falla si
quedó vieja).

## Bots: de reglas, **no** de aprendizaje por refuerzo

Cada bot es una máquina de estados finita evaluada en cada tick:

- **RETREAT**: hay enemigo visible y la vida bajó del umbral de su clase (el Phantom también se retira si un enemigo está a menos de 12 u); busca refugio detrás de una pared.
- **ATTACK**: hay un enemigo visible (visión 45 u, 75 para el Phantom; un camuflado solo se ve a menos de 6 u). Apunta con adelanto según la velocidad estimada del objetivo y con error de puntería por clase; se acerca hasta su rango y luego se mueve de lado (el Interceptor flanquea).
- **SUPPORT** (Spectre sin enemigos a la vista): va hacia el aliado más herido.
- **DEFEND** (Titan sin enemigos a la vista): se coloca entre su grupo y el centro.
- **PATROL**: recorre puntos de la arena o, si es Phantom, puestos de tirador.
- **RESPAWN**: destruido, espera la reaparición.

Las rutas usan **A\*** sobre una cuadrícula de 2 u (máx. 900 expansiones y 1 ruta
nueva por tick para proteger el tick). Las habilidades se usan con reglas fijas y
un tiempo de reacción (15 % de probabilidad por tick): p. ej. el Titan pone escudo
con menos del 80 % de vida y se fortifica con menos del 50 %; el Spectre cura si
un aliado cercano tiene menos del 60 %; el Destroyer bombardea el centro de un
grupo de enemigos. El modelo PPO de la práctica 3.1 no
se usa en el juego: se usó para medir el costo de inferencia en CPU y GPU.

## Impacto en la infraestructura (mediciones)

### Costo del tick y tamaño del snapshot

Simulación directa de `Partida.paso()` durante 2 minutos de juego (2,400 ticks,
1 humano quieto + 9 bots), misma máquina (Windows 11, Python 3.12), dos corridas
cada versión. Script: equivalente a `server.snapshot()` sin red.

| | 1.2 | 2.0 |
|---|---|---|
| Tick promedio | 0.31 ms | 0.72–0.80 ms |
| Tick p99 | 0.86–0.90 ms | 1.87–3.26 ms |
| Tick máximo | 1.6–1.9 ms | 3.7–7.5 ms |
| Snapshot promedio | 2,414 B | 3,598 B (+49 %) |
| Snapshot p99 | 2,711 B | 4,193 B |

Lectura: el tick de la 2.0 cuesta ~2.5× más (A\*, proyectiles, habilidades), pero
el presupuesto a 20 ticks/s es de 50 ms: el peor tick medido usa el 15 %. El
servidor real sostuvo **19.98 ticks/s** con 10 clientes (`cliente_prueba.py`,
RTT p95 22.7 ms, 0 mensajes inválidos). El snapshot crece 49 % por los campos
`clase`, `est`, `cd`, `escudo` y los eventos de proyectiles: a 20 Hz y 10
espectadores/jugadores son ~0.7 Mbit/s por servidor (antes ~0.5). Esto importa
para la 3.4 (ancho de banda de egress) y para el `requests` de CPU de la flota.

### Rampa local en kind

Misma rampa que la 1.2 (0 → 120 jugadores, 1/s, 6 min, Locust contra el matchmaker
en kind de un nodo), imagen `nebula-server:2.0` puesta con `kubectl patch` en la
flota local. Datos en `loadtest/reports/rampa-local-v2.0/`. CPU y tick salen de
Prometheus en la ventana de cada corrida.

| | Servidor 1.2 | Servidor 2.0 |
|---|---|---|
| CPU por servidor con jugadores (promedio / máx.) | 0.047 / 0.074 núcleos | 0.041 / 0.068 núcleos |
| Tick rate con jugadores (promedio / mínimo) | 17.7 / 12.1 | 19.7 / 16.2 |
| Tick p99 (promedio de los servidores) | 40 ms | 48 ms |
| Pico de CCU (Prometheus) | 70 | 44 |
| Servidores vivos (máx.) | 13 | 7 |
| RTT p50 / p95 | 16 / 390 ms | 36 / 6,900 ms |
| Asignaciones fallidas | 21 de 28 | 11 de 17 |
| Primer escalado de la flota | 74 s | 69 s |

Lectura honesta: en kind la limitación sigue siendo **el nodo único**, no el
servidor. El nodo kind ya consumía ~3.3 núcleos solo con Agones, Prometheus y
Grafana (`docker stats`), y los servidores locales tienen un límite de 50m de CPU
(`k8s/local/fleet-local.yaml`). Por eso el tick p99 de las dos versiones queda
cerca de 40–50 ms y el RTT p95 se dispara cuando la flota no alcanza a escalar.
Las dos corridas no son comparables en CCU (la segunda tuvo menos asignaciones
exitosas). Lo que sí se puede leer es que la 2.0 **no usa más CPU por servidor**
que la 1.2 en las mismas condiciones. La comparación válida para la rúbrica es
la rampa de 1,000 en GKE (pendiente).

### FPS del cliente

Medido en la partida con 10 naves, AMD Radeon 660M integrada, ventana de
637×626 px (pixel ratio 1.25), 4 s por perfil:

| Perfil | FPS | Cuadro p95 | Render promedio / p95 / máx. |
|---|---|---|---|
| ALTO | 60.3 | 16.8 ms | 3.1 / 5.4 / 8.5 ms |
| BAJO | 57.3 (incluye recompilar shaders al cambiar) | 16.9 ms | 3.8 / 7.1 / 12.5 ms |

Antes de corregir las sombras, ALTO renderizaba en 9.9 ms promedio, con un p95 de
19 ms y picos de 37 ms. Cuadros de hasta 76 ms se sentían como tirones. Dos
causas: las **dos** luces direccionales proyectaban sombra (dos pasadas sobre 318
objetos en cada cuadro), y el mapa de sombras se recalculaba aunque el escenario
no se mueva. Ahora solo el sol proyecta sombra y su mapa se dibuja una vez. Las
naves ya traían su sombra de contacto. Pendiente: medir en pantalla completa
1920×1080.

## Errores encontrados durante el rediseño

1. **Bombardeo aliado tratado como campo de apoyo** (`habilidades._campo_que_protege`):
   una nave dentro de un bombardeo de su equipo hacía fallar el tick con
   `KeyError: 'reduccion'`. Lo encontró la medición del tick, no las pruebas.
   Corregido y con prueba de regresión
   (`test_bombardeo_aliado_no_cuenta_como_campo_de_apoyo`).
2. **El tick de la primera versión 2 costaba 8 ms**: la línea de visión se
   calculaba por muestreo y A\* no tenía límite. Se reemplazó por intersección
   analítica segmento-caja, poda por caja envolvente y A\* acotado (1.3–2 ms).
3. **El núcleo del centro tapaba el punto (50, 50)**, que una prueba antigua usa
   como posición válida. Se movieron los núcleos fuera del centro; el reactor
   del centro es solo visual.
4. **Tirones en ALTO**: doble sombra direccional recalculada en cada cuadro (ver FPS).
5. **`zoom` de la cámara**: `OrthographicCamera` ya tiene una propiedad `zoom`
   numérica que pisaba el método; se renombró a `acercar`.

## Cómo correrlo

```bash
.venv/Scripts/python -u server/server.py
cd client && npm install && npm run dev      # http://localhost:5173
```

Pruebas: `cd server && ../.venv/Scripts/python -m pytest -q` (82).
Si cambian `server/clases.py` o `server/estacion.py`:
`.venv/Scripts/python tools/exportar_datos_cliente.py`.
