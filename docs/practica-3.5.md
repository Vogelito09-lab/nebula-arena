# Práctica 3.5 — Tabla de líderes serverless

**Objetivo:** recibir el resultado de cada partida y mantener el top 10 global sin
administrar servidores (Cloud Run + Firestore, la opción Google Cloud del material).

| Paso | Estado |
|---|---|
| Código (`serverless/main.py`) y pruebas | Hecho: 16 pruebas pasan |
| Imagen del contenedor | Se construye (289 MB) y gunicorn arranca; la respuesta HTTP del contenedor no se pudo comprobar en local con Docker saturado por el clúster kind |
| Despliegue en Cloud Run, URL funcionando | **Pendiente: necesita la cuenta de Google Cloud** |
| Prueba de carga 80/20 hasta 500 usuarios | Script listo (`loadtest/locust_leaderboard.py`); **pendiente** de correr contra Cloud Run |
| Comparación de costo serverless vs VM | **Pendiente:** con la calculadora oficial |

## API

Mismos endpoints y misma colección (`scores`) que el ejemplo del material, con
los campos que pide la tabla del proyecto:

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/score` | `{"jugador": "ana", "puntos": 1250, "resultado": "victoria"}`. Suma puntos y partidas. `resultado` es opcional (`victoria` o `derrota`), así que el `curl` del material funciona igual |
| `GET` | `/top` | Top 10: `posicion`, `jugador`, `puntos`, `partidas`, `victorias`, `derrotas` |
| `GET` | `/jugador/<id>` | Estadísticas de un jugador |
| `GET` | `/healthz` | Salud |

Agregados sobre el ejemplo del material:

- **Validación de entradas:** id de 1–32 caracteres (`A-Z a-z 0-9 _ -`) y puntos enteros entre 0 y 100,000. Los errores responden `400` con un mensaje.
- **Escrituras protegidas:** si la variable `SCORE_API_KEY` existe, `POST /score` exige la cabecera `X-Api-Key` (comparación en tiempo constante). La llave vive en Secret Manager (Terraform crea el secreto vacío) y se monta como variable de entorno. Leer `/top` es público.
- **Errores:** las excepciones no controladas se registran en el log y responden `500` sin filtrar detalles.

## Pruebas

```bash
cd serverless
../.venv/Scripts/python -m pip install -r requirements-dev.txt
../.venv/Scripts/python -m pytest -q          # 16 passed
```

Usan un Firestore falso en memoria que imita `set(merge=True)` con
`firestore.Increment`, `order_by().limit().stream()` y `get()`. Cubren el top
ordenado y limitado a 10, el conteo de victorias y derrotas, el formato del
material sin `resultado`, 10 casos de entrada inválida y la llave de API.

## Despliegue (pendiente)

Con los comandos del material, más la cuenta de servicio y el secreto que crea
Terraform (o créalos a mano):

```bash
gcloud services enable run.googleapis.com firestore.googleapis.com cloudbuild.googleapis.com
gcloud firestore databases create --location=nam5          # si no usaste Terraform
gcloud run deploy nebula-leaderboard --source serverless --region us-central1 \
  --allow-unauthenticated --min-instances 0 --max-instances 50 \
  --service-account nebula-leaderboard@<PROYECTO>.iam.gserviceaccount.com \
  --set-secrets SCORE_API_KEY=score-api-key:latest
URL=$(gcloud run services describe nebula-leaderboard --region us-central1 --format='value(status.url)')
curl -X POST $URL/score -H "Content-Type: application/json" -H "X-Api-Key: $SCORE_API_KEY" \
  -d '{"jugador":"ana","puntos":1250,"resultado":"victoria"}'
curl $URL/top
```

`--allow-unauthenticated` deja leer el top sin login, como en el material. Las
escrituras siguen protegidas por la llave.

## Prueba de carga (pendiente)

```bash
export SCORE_API_KEY=<la misma llave del secreto>
locust -f loadtest/locust_leaderboard.py --host $URL -u 500 -r 25 -t 5m \
       --headless --csv loadtest/reports/leaderboard
```

Qué registrar para el entregable:

- **Concurrencia:** en Cloud Monitoring, métrica *Instance count* del servicio durante la prueba (captura).
- **p99 y arranques en frío:** el p99 de `GET /top` y `POST /score` en `leaderboard_stats.csv`. Para aislar el arranque en frío, compara los primeros 30 s de `leaderboard_stats_history.csv` (instancias nuevas) contra el resto. Si quieres el contraste explícito, repite con `--min-instances 1`.

## Costo serverless vs VM (pendiente)

Llenar con la calculadora oficial usando el volumen medido en la prueba
(peticiones por segundo × segundos al mes), comparado contra una `e2-small`
encendida 730 h al mes. El material da como referencia que una tabla de líderes
de 5 millones de consultas al mes cabe casi entera en la capa gratuita, frente a
decenas de dólares de un servidor encendido 24/7.
