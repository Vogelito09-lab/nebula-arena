# Reporte técnico — Nebula Arena en la nube (BORRADOR)

Unidad 3: Infraestructura y despliegue de videojuegos en la nube.
Máximo 6 páginas. **Borrador:** las secciones marcadas `PENDIENTE (GKE)` se llenan
con las mediciones en Google Cloud; no se escriben números que no se hayan medido.
Todas las cifras de este borrador vienen de mediciones en local (laptop Windows
11, Docker Desktop, kind de un nodo) o de precios oficiales, con su fecha.

## 1. Resumen

Nebula Arena es un shooter de arena 5 vs 5 en 3D con bots, usado como caso de
estudio. El servidor de partida es autoritativo (Python asyncio + WebSocket, 20
ticks/s), corre en contenedores administrados por **Agones** sobre **GKE**, escala
en tres capas (flota, pods, nodos), se mide con **Prometheus/Grafana**, se prueba
con **Locust**, se publica con **GitHub Actions**, guarda la tabla de líderes en
**Cloud Run + Firestore** y toda la infraestructura se crea con **Terraform**.

Estado: todo está construido y probado en local; la ejecución en Google Cloud
está pendiente de la cuenta (la prueba gratuita pidió un prepago).

## 2. Arquitectura

```
 Jugadores ──HTTP──▶ Matchmaker (Deployment + HPA) ──GameServerAllocation──▶ Agones
     │                                                                     │
     └──────────── WebSocket :7000-8000 ──────────▶ GameServer (pod) ◀──────┘
                                                    │  server.py 20 Hz
                                                    │  /metrics :9100 ──▶ Prometheus ──▶ Grafana
                                                    └─ fin de partida ──POST /score──▶ Cloud Run ──▶ Firestore
 Espectadores ──HLS──▶ Cloud CDN ◀── bucket (video de prueba)
 GitHub Actions: pruebas → smoke → publicar (Artifact Registry) → desplegar (Fleet)
 Terraform: red, GKE + Cluster Autoscaler, Artifact Registry, IAM, Firestore, Agones
```

| Capa | Componente | Archivo |
|---|---|---|
| Juego | Servidor autoritativo, 5 clases, bots de reglas con A* | `server/` |
| Contenedor | `python:3.11-slim`, usuario sin privilegios | `server/Dockerfile` |
| Orquestación | Fleet + FleetAutoscaler (buffer 20 %) | `k8s/fleet.yaml`, `k8s/autoscaler.yaml` |
| Servicio sin estado | Matchmaker con HPA por CPU | `matchmaking/`, `k8s/matchmaker.yaml` |
| Métricas | PodMonitor + dashboard (14 paneles) | `k8s/podmonitor.yaml`, `monitoring/` |
| Carga | Locust: jugadores y espectadores | `loadtest/` |
| Serverless | Tabla de líderes, `POST /score`, `GET /top` | `serverless/` |
| IaC | Módulos y entornos dev/staging/prod | `infra/` |

**Decisiones principales**
- Servidor autoritativo: el cliente no decide daño ni posiciones; se rechazan teletransportes, paredes atravesadas y mensajes inválidos.
- El servidor llama a `/shutdown` solo cuando la partida termina, así Agones nunca recicla un servidor con jugadores (drenado en actualizaciones).
- El matchmaker existe para que la capa de pods escale de verdad (el material solo lo usa de ejemplo).
- La llave de la cuenta de servicio vive solo como secreto de GitHub; Terraform no la genera.

## 3. Práctica 3.1 — Bot e inferencia

| Medición (Colab, T4) | Resultado |
|---|---|
| Entrenamiento CPU vs GPU | **La GPU fue 68 % más lenta** (red pequeña: copiar a la GPU cuesta más que calcular) |
| Capacidad por vCPU de nube | 2,315–2,787 inferencias/s |
| 2,000 bots a 10 Hz | 20,000 inferencias/s → **12 vCPU** con 30 % de margen |
| Costo (precios oficiales, us-central1, 2026-11-09) | 3 × `c3-standard-4` = **USD 0.6048/h** (USD 441.52/mes), **USD 0.0003 por bot y hora** |

Los bots del juego son de reglas (máquina de estados con A*); el modelo de la
3.1 se usó solo para medir costo de inferencia. Detalle: `docs/practica-3.1.md`.

## 4. Contenedores y orquestación (3.3)

En local (kind + Agones 1.62): 3 GameServers en `Ready` a los 20 s;
`Ready → Allocated` con la asignación; 10 jugadores con tick rate 19.68;
`Allocated → Shutdown` al salir todos y un servidor nuevo en `Ready` en menos de
7 s. Actualización 1.0 → 1.1 de la flota en ~50 s sin cortar partidas.

`PENDIENTE (GKE)`: capturas de `kubectl get gameservers` antes y después de la
asignación, `/metrics` del pod y la IP pública.

## 5. CI/CD (3.2)

Pipeline: `pruebas` (pytest) → `smoke` (imagen + partida de 10 jugadores contra
el contenedor; falla si el tick rate < 19) → `publicar` (imagen con el SHA del
commit) → `desplegar` (Fleet con esa imagen, espera un servidor `Ready`).
Corrida en verde el 2026-11-05 (pruebas y smoke).

**Rollback:** volver a desplegar la imagen del commit anterior, que sigue en
Artifact Registry con su SHA (`kubectl apply` de la Fleet con esa etiqueta, o
revertir el commit para que el pipeline la publique). Agones reemplaza solo los
servidores libres; las partidas en curso terminan con la versión que tenían.

`PENDIENTE (GKE)`: captura con `publicar` y `desplegar` en verde.

## 6. Autoescalado y pruebas de carga (3.4)

**Ensayos en local (kind, un nodo, rampa 0 → 120 jugadores a 1/s):**

| | Servidor 1.1 | Servidor 1.2 | Servidor 2.0 |
|---|---|---|---|
| CCU máximo (Prometheus) | 30 | 70 | 44 |
| Servidores vivos (máx.) | 3 | 13 | 7 |
| Primer escalado de la flota | nunca | 74 s | 69 s |
| RTT p50 / p95 | 8 / 37 ms | 16 / 390 ms | 36 / 6,900 ms |

**Hallazgos que corrigieron el sistema**
1. `/ready` se llamaba una sola vez; si el sidecar de Agones arrancaba tarde, el servidor quedaba en `Scheduled` y la flota dejaba de escalar → reintento (1.2).
2. Python como PID 1 ignoraba `SIGTERM`: 30 s para morir → 2 s (1.1).
3. Un nodo local se satura en ~60–70 jugadores: fallan los health checks y Agones borra servidores con partida. En GKE eso debe disparar el Cluster Autoscaler.
4. El buffer de 20 % no alcanzó con arranques de hasta 1 min: la flota pasó 74 % del tiempo sin servidores `Ready` en la corrida 1.2.

Las corridas locales no son comparables entre sí en CCU (distinto número de
asignaciones exitosas) y no representan la capacidad de un nodo de GKE: en kind
Prometheus, Grafana y Locust compiten por la misma CPU.

`PENDIENTE (GKE)`:
- Rampa de 1,000 jugadores (2/s, 20 min) y pico 1× → 10× en un minuto.
- Curva CCU vs latencia p95, servidores por estado, nodos.
- **Capacidad máxima medida** (jugadores por nodo) y **tiempo de reacción** de cada capa (flota, HPA, nodos).
- 500 espectadores HLS por Cloud CDN.

**Extrapolación de espectadores (cálculo):** 20,000 espectadores a 1080p (6,000
kbps) durante 1 hora = 20,000 × 6,000 × 3,600 / 8×10⁶ = **54,000 GB ≈ 54 TB**
(120 Gbps). `PENDIENTE`: costo con la tarifa de egress de Cloud CDN.

## 7. Tabla de líderes serverless (3.5)

API con validación de entradas y escrituras protegidas por llave (Secret
Manager); 16 pruebas en verde. `PENDIENTE (GKE)`: URL en Cloud Run, carga 80/20
con 500 usuarios, instancias concurrentes, p99 y efecto del arranque en frío, y
costo serverless vs VM pequeña todo el mes.

## 8. Infraestructura como código (3.6)

Módulos `servicios`, `red`, `iam`, `registro`, `gke`, `agones`; estado remoto en
GCS con bloqueo; entornos por workspace (`dev` 2 × e2-standard-4, `staging`
3–12, `prod` 3–20 × c3-standard-4). `terraform fmt` y `validate` pasan.
`PENDIENTE`: `plan` revisado en un pull request, `apply`, captura del clúster y
`destroy` sin recursos huérfanos.

## 9. Costos

| Concepto | Valor | Fuente |
|---|---|---|
| Inferencia de 2,000 bots | USD 0.60/h | Precios oficiales, 2026-11-09 |
| Entrenamiento de un bot | USD 0.0022 | e2-standard-2 × 2 min |
| Clúster por hora (nodos de juego) | `PENDIENTE` | Calculadora + uso real |
| Costo por jugador y hora | `PENDIENTE` = costo del clúster / CCU sostenido | Prueba de 1,000 |
| Egress de 20,000 espectadores | `PENDIENTE` (54 TB/h × tarifa CDN) | Calculadora |
| Serverless vs VM | `PENDIENTE` | Calculadora |

## 10. Recomendaciones (preliminares)

- `bufferSize` mayor o escalado programado antes de picos esperados; bajar el intervalo de sincronización del FleetAutoscaler (30 s por defecto). Confirmar con datos de GKE.
- Servidores de partida **bajo demanda**, no Spot (una interrupción corta la partida); el entrenamiento de bots sí puede ir en Spot.
- Bots en C3 (`c3-highcpu-4` ahorra 16 % frente a `standard`, el modelo no usa la memoria extra).
- `PENDIENTE`: tipo de máquina y mínimo de nodos justificados con la prueba de 1,000.

## 11. Conclusiones

`PENDIENTE` hasta tener los datos de GKE. Lo demostrado en local: el sistema
completo funciona de punta a punta, y las pruebas de carga encontraron y
corrigieron dos fallas reales de ciclo de vida (`/ready` y `SIGTERM`); la de
`/ready` viene del ejemplo del material, que llama a `/ready` una sola vez.
