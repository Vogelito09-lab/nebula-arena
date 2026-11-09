# Guía para la revisión (todo en local, sin nube)

Qué enseñar, en qué orden y con qué comandos. Unos 10 minutos.
Todo corre en la laptop. La parte de Google Cloud está **pendiente** y hay que
decirlo así (ver el final).

## Antes de que llegue el profe (5 min)

1. Abre **Docker Desktop** y espera a que diga *Engine running*.
2. Terminal 1, el servidor del juego:

   ```bash
   cd nebula-arena
   .venv/Scripts/python -u server/server.py
   ```

3. Terminal 2, el cliente:

   ```bash
   cd nebula-arena/client
   npm run dev
   ```

   Abre http://localhost:5173.

4. (Opcional, para enseñar Kubernetes) Prende el clúster local y Grafana:

   ```bash
   docker start nebula-control-plane
   kubectl get pods -A          # espera a que todo esté Running (1–2 min)
   kubectl get gameservers
   kubectl port-forward -n monitoring svc/monitoreo-grafana 3000:80
   ```

   Grafana queda en http://localhost:3000 con el tablero *Nebula Arena*.

Ten abiertas también, en pestañas: el repositorio en GitHub, el pull request y
las gráficas de `loadtest/reports/rampa-local-v1.2/` y `rampa-local-v2.0/`.

## Orden de la demostración

### 1. El juego (2 min)
- Menú → **Hangar**: 5 naves (flechas para cambiar, Enter para equipar).
- **Jugar**: partida 5 vs 5; los que faltan son bots. Enseña una habilidad (Q/E/Espacio).
- Qué decir: *"El servidor es autoritativo a 20 ticks por segundo: valida
  movimiento, disparos y habilidades. El cliente solo dibuja y predice."*
- **Espectador** (desde otra pestaña): mira la partida sin ocupar lugar. Sin
  jugadores, corre una exhibición de bots.

### 2. Calidad del código (1 min)
```bash
cd server && ../.venv/Scripts/python -m pytest -q        # 82 passed
```
Qué decir: *"Las 29 pruebas de la versión anterior no se modificaron: el
rediseño no rompió el protocolo que usan Agones, las métricas y las pruebas de carga."*

### 3. Contenedor y métricas (1 min)
- `server/Dockerfile` (usuario sin privilegios, imagen slim).
- http://localhost:9100/metrics → `nebula_tick_rate`, `nebula_players_connected`, `nebula_tick_seconds`.

### 4. Kubernetes + Agones en local (2 min, si prendiste kind)
- `kubectl get gameservers` → servidores en `Ready`.
- `kubectl create -f k8s/allocation.yaml` y otra vez `kubectl get gameservers` → uno pasa a `Allocated`.
- Si se borra un pod `Allocated`: Agones no lo recrea en ese estado; la partida
  se pierde y el FleetAutoscaler crea otro servidor libre. Por eso el servidor solo
  se apaga cuando la partida terminó (drenado).
- Evidencia escrita: `docs/evidencias/3.3-agones-local.txt`.

### 5. Autoescalado y carga (2 min)
Enseña `loadtest/reports/rampa-local-v1.2/` (`ccu_vs_p95.png`,
`ccu_vs_servidores.png`, `reaccion_autoescalado.png`) y cuenta los hallazgos:
- `/ready` se llamaba una sola vez y un servidor podía quedarse en `Scheduled` para siempre → corregido (reintenta).
- Python como PID 1 ignoraba `SIGTERM` (30 s para morir) → corregido (2 s).
- Un nodo local se satura cerca de 60–70 jugadores → por eso la prueba real es en GKE con Cluster Autoscaler.

### 6. CI/CD (1 min)
Pull request #1 en GitHub: `pruebas` → `smoke` (imagen + partida de 10
jugadores, falla si el tick rate baja de 19) → `publicar` → `desplegar`.
Publicar y desplegar esperan a que exista el proyecto de Google Cloud.

### 7. Costo (1 min)
Práctica 3.1: la GPU fue 68 % más lenta que la CPU para este bot; 2,000 bots a
10 Hz necesitan 12 vCPU ≈ **USD 0.60 por hora** (3 × `c3-standard-4`,
`us-central1`, precios oficiales). Detalle en `docs/practica-3.1.md`.

## Lo que falta (decirlo tal cual)

> "Todo está hecho y probado en local. Lo que falta es correrlo en Google Cloud:
> la cuenta de prueba me pide un prepago de MXN 600 para activarse. ¿La materia
> tiene créditos educativos de Google Cloud?"

Pendiente en la nube: GKE con capturas (3.3), pipeline publicando (3.2), rampa
de 1,000 jugadores y 500 espectadores (3.4), Cloud Run con carga (3.5),
Terraform `apply`/`destroy` (3.6), y con esos datos el reporte final y la demo
del autoescalado.

## Al terminar

Ctrl+C en las dos terminales. Si prendiste kind: `docker stop nebula-control-plane`.
