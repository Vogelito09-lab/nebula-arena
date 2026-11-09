# Nebula Arena

Shooter de arena 5 vs 5 con bots de IA, usado como caso de estudio de la
**Unidad 3: Infraestructura y despliegue de videojuegos en la nube**. El repositorio
sigue las prácticas del material en el orden recomendado: 3.1 → 3.3 → 3.2 → 3.4 → 3.5 → 3.6.

## Estado

| Práctica | Hecho y probado | Falta | Documento |
|---|---|---|---|
| 3.1 Entrenar y servir un bot | CPU vs GPU T4 medidos en Colab; dimensionamiento de 2,000 bots | Costo por hora (calculadora) | [practica-3.1](docs/practica-3.1.md) |
| 3.3 Contenedores y orquestación | Servidor 2.0 (5 clases, proyectiles, habilidades, bots de reglas), imagen, 82 pruebas (las 29 de la 1.2 sin cambios); flota de Agones en kind (Ready → Allocated → Shutdown) | **Primero al tener Google Cloud:** Artifact Registry, GKE y capturas de `kubectl get gameservers` | [practica-3.3](docs/practica-3.3.md) |
| 3.2 Pipeline CI/CD | Workflow en GitHub con pruebas y smoke test en verde | Publicar y actualizar la flota en GKE | [practica-3.2](docs/practica-3.2.md) |
| 3.4 Autoescalado y carga | Autoscaler, matchmaker + HPA, Prometheus, Grafana y Locust en kind; 2 rampas locales con gráficas | Rampa y pico de 1,000, 500 espectadores y nodos escalando, en GKE | [practica-3.4](docs/practica-3.4.md) |
| 3.5 Tabla de líderes | API (`POST /score`, `GET /top`), 16 pruebas, imagen | Desplegar en Cloud Run, carga 80/20 de 500 usuarios, costo | [practica-3.5](docs/practica-3.5.md) |
| 3.6 Terraform | Módulos, entornos dev/staging/prod; `fmt` y `validate` pasan | `plan`, `apply` y `destroy` en el proyecto | [infra/README](infra/README.md) |
| Cliente 3D (V2) | Three.js: cámara isométrica, Orbital Station, 5 naves, menú con hangar 3D, HUD militar, audio procedural, perfiles BAJO/ALTO; probado contra el servidor local ([rediseño](docs/rediseno-v2.md)) | Apuntar a un servidor en GKE (no lo califica la rúbrica) | [Jugar](#jugar-en-local) |

Todo lo que dice "falta" no está hecho ni medido. Las cifras de los documentos
son mediciones reales, con su fecha y la máquina donde se tomaron. Lo hecho en
**kind** (Kubernetes local) es un ensayo: las evidencias del entregable deben
salir de GKE.

**Orden al activar Google Cloud** ([cómo activarlo](docs/google-cloud.md)):
3.3 en la nube → 3.2 publicando → 3.4 → 3.5 → 3.6 → reporte y demo.

## Hallazgos de los ensayos

1. **Python como PID 1 ignoraba `SIGTERM`:** un pod borrado tardaba 30 s en morir. Corregido en 1.1 (ahora 2 s).
2. **`/ready` se llamaba una sola vez** (como en el ejemplo del material): si el sidecar de Agones arrancaba tarde, el servidor se quedaba en `Scheduled` para siempre y la flota dejaba de escalar. Corregido en 1.2 (reintenta).
3. **La GPU fue 68 % más lenta que la CPU** para entrenar este bot (red pequeña).
4. **Un nodo local satura alrededor de 60–70 jugadores:** Agones empieza a borrar servidores por fallas de health check.

## Estructura

```
ai/training/        3.1: script de entrenamiento, notebook de Colab y resultados
server/             servidor de partida (server.py, Dockerfile, pruebas, cliente de prueba)
matchmaking/        matchmaker sin estado (Flask) que pide servidores a Agones
serverless/         3.5: tabla de líderes para Cloud Run + Firestore
k8s/                Fleet, FleetAutoscaler, PodMonitor, matchmaker + HPA, allocation
k8s/local/          variantes para el clúster local kind
infra/              3.6: Terraform (módulos y entornos)
loadtest/           3.4/3.5: Locust, análisis y reportes
monitoring/grafana/ dashboard
.github/workflows/  3.2: pipeline CI/CD
docs/               una guía por práctica + evidencias
client/             cliente 3D (Vite + Three.js)
```

## Inicio rápido (local)

Requisitos: Python 3.11 o 3.12 y Docker Desktop.

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r server/requirements-dev.txt -r matchmaking/requirements-dev.txt -r serverless/requirements-dev.txt

# pruebas (82 + 5 + 16)
cd server && ../.venv/Scripts/python -m pytest -q && cd ..
cd matchmaking && ../.venv/Scripts/python -m pytest -q && cd ..
cd serverless && ../.venv/Scripts/python -m pytest -q && cd ..

# imagen y prueba con 10 jugadores
docker build -t nebula-server:1.2 server
docker run -d --name nebula -p 7654:7654 -p 9100:9100 nebula-server:1.2
.venv/Scripts/python server/cliente_prueba.py --jugadores 10 --segundos 10
curl localhost:9100/metrics | grep nebula
docker rm -f nebula
```

## Jugar en local

Requiere Node 20+. En una terminal el servidor y en otra el cliente:

```bash
.venv/Scripts/python -u server/server.py
```

```bash
cd client && npm install && npm run dev
```

Abre http://localhost:5173, escribe tu callsign, elige nave en **Hangar** y pulsa
**Jugar**. Controles: WASD para moverse (relativo a la pantalla), mouse para apuntar,
clic para disparar, Q y E habilidades, Espacio propulsión, rueda para el zoom, Tab
para el marcador y Esc para el menú (la partida no se pausa). Al ser destruido
puedes cambiar de nave con las teclas 1–5.
Si faltan humanos, el servidor completa cada equipo hasta 5 con bots. La partida
termina a las 50 bajas o a los 5 minutos (si hay empate, prórroga: la siguiente baja
gana, máx. 60 s). El modo espectador se conecta a
`ws://<servidor>:7654/espectador` y no ocupa lugar de jugador; si la arena no tiene humanos, el servidor arma una exhibición solo de bots. Para usar otro
servidor: `?servidor=ws://IP:PUERTO`; para mostrar la clasificación de la 3.5:
`?leaderboard=https://URL-de-cloud-run`.

Cómo funciona: el servidor es autoritativo. Valida cada movimiento (velocidad de
la clase y paredes) y responde con una corrección si no es válido. También simula
los disparos (rayo, proyectiles y railgun, con la cadencia de cada clase, sin fuego
amigo), las habilidades y sus enfriamientos, el daño, las asistencias y el
marcador. El cliente predice solo su propio movimiento y dibuja a los demás
interpolados 100 ms atrás. **Los bots son de reglas** (máquina de estados PATROL,
ATTACK, DEFEND, SUPPORT, RETREAT, RESPAWN con rutas A\*), no de aprendizaje por refuerzo. No usan el
modelo PPO de la práctica 3.1; ese modelo se usó para medir costo de inferencia en
CPU y GPU.

El servidor 2.0 son varios módulos (`juego.py`, `clases.py`, `combate.py`, …):
hay que reconstruir la imagen (`docker build -t nebula-server:2.0 server`).

Clúster local con Agones, monitoreo y carga: ver [practica-3.3](docs/practica-3.3.md)
y [practica-3.4](docs/practica-3.4.md). Para apagarlo: `kind delete cluster --name nebula`.

## Seguridad

- Nunca se suben credenciales: `.gitignore` excluye `key.json`, certificados, `.env` y el estado de Terraform.
- En CI, la llave de la cuenta de servicio va como secreto de GitHub (`GCP_SA_KEY`).
- La llave de escritura de la tabla de líderes vive en Secret Manager.
- Cuentas de servicio con permisos mínimos: nodos (logs, métricas, leer imágenes), GitHub (publicar imágenes, actualizar la flota), matchmaker (solo crear `GameServerAllocation`) y tabla de líderes (Firestore y su secreto).
- Entradas validadas en el servidor de juego, el matchmaker y la tabla de líderes. El servidor es autoritativo en lo que valida: un cliente no puede salirse de la arena ni mover a otro jugador.
