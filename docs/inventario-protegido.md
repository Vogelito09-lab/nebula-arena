# Inventario protegido del rediseño V2

El rediseño V2 cambia el juego, pero la rúbrica califica la infraestructura. Esta
lista es lo que el rediseño **no podía romper** y cómo quedó cada pieza. Revisado
el 2026-11-05 en la rama `v2-rediseno`.

| Pieza | Archivo(s) | Estado en V2 | Cómo se comprobó |
|---|---|---|---|
| Protocolo del servidor (mensaje `{id, x, y, dir, dispara, nombre}`, snapshot `{t, e, ...}`) | `server/server.py` | **Compatible.** Los campos nuevos (`clase`, `hab`, `ax/ay`, `mdx/mdy`) son opcionales; uno mal formado descarta el mensaje, como antes. El snapshot solo **agrega** `pr` (prórroga), `z` (zonas) y `ex` (exhibición). | 29 pruebas antiguas sin modificar + `test_mensaje_de_la_1_2_sigue_siendo_valido` |
| Clase por defecto con el arma de la 1.2 | `server/clases.py` | Spectre: 100 de vida, velocidad 12, rayo instantáneo de 25 de daño cada 0.25 s. Quien no elige clase juega la 1.2. | `test_clase_por_defecto_es_spectre_con_los_valores_de_la_1_2` |
| Equipos internos `azul`/`rojo` | todo el servidor | Sin cambio. "BLUE SQUAD"/"RED SQUAD" solo existe en la pantalla. | Pruebas antiguas de equipos |
| Métricas `nebula_*` | `server/server.py` | Las 1.2 siguen igual. Se agregan `nebula_abilities_total{clase,habilidad}` y `nebula_projectiles_active`. | `curl :9100/metrics` (tick rate 19.98) |
| Agones (`/ready`, `/health`, `/allocate`, `/shutdown`) | `server/server.py` | Sin cambio (la llamada sigue en segundo plano, como en la corrección de la 1.2). | Flota en kind con la imagen `nebula-server:2.0` |
| `/espectador` | `server/server.py` | Misma ruta y mismos snapshots; la bienvenida agrega `clases`. **Corrección:** ahora lee los mensajes del espectador y contesta su ping; antes la cola de entrada se llenaba y la conexión se caía con 1011 al minuto (bug que ya existía en la 1.2). | `test_espectador.py` + espectador conectado más de 2 min |
| Matchmaker + HPA | `matchmaking/`, `k8s/matchmaker.yaml` | No se tocó. | 5 pruebas en verde |
| Fleet, FleetAutoscaler, PodMonitor | `k8s/` | No se tocaron. La imagen local se cambió a 2.0 solo con `kubectl patch` para la rampa. | Rampa local v2.0 |
| Terraform | `infra/` | No se tocó. | — |
| Tabla de líderes (Cloud Run + Firestore), `LEADERBOARD_URL`, `SCORE_API_KEY` | `serverless/`, `server/server.py` | Sin cambio. El resultado que publica el servidor conserva sus campos; el cliente **nunca** escribe en la tabla (las estadísticas del cliente son locales). | 16 pruebas en verde |
| Grafana | `monitoring/` | No se tocó. | — |
| Dockerfile del servidor | `server/Dockerfile` | Único cambio: `COPY *.py ./` porque el servidor ahora son varios módulos. Las pruebas siguen fuera de la imagen (`.dockerignore`). | `docker build` + `cliente_prueba.py` |
| CI (pruebas + smoke test con tick rate ≥ 19) | `.github/workflows/deploy.yml` | No se tocó. | Pendiente: correr en GitHub al subir la rama |
| Smoke test, Locust, `cliente_prueba.py` | `server/cliente_prueba.py`, `loadtest/` | No se tocaron; siguen funcionando porque usan el mensaje de la 1.2. | `cliente_prueba.py` 10 jugadores: RTT p95 22.7 ms, 0 mensajes inválidos |
| Pruebas antiguas | `server/tests/test_*.py` (29) | **Ninguna se modificó.** | `pytest`: 82 en verde (29 antiguas + 53 nuevas) |

## Lo que no se usó (por decisión)

- Sin Node en el servidor, sin Colyseus, sin Postgres, sin Docker Compose: el
  servidor sigue siendo Python asyncio + websockets y el despliegue sigue siendo
  Agones.
- Sin aprendizaje por refuerzo en los bots: son de reglas (ver `docs/rediseno-v2.md`).
