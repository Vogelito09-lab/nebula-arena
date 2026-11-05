"""Práctica 3.5 — Prueba de carga de la tabla de líderes serverless.

80 % lecturas de /top y 20 % escrituras en /score, hasta 500 usuarios:

  locust -f locust_leaderboard.py --host https://<URL-de-Cloud-Run> \
         -u 500 -r 25 -t 5m --headless --csv reports/leaderboard

Si el servicio tiene SCORE_API_KEY, exporta la misma llave en SCORE_API_KEY
antes de correr Locust (nunca la escribas en este archivo).
Mientras corre, observa en Cloud Monitoring la métrica de instancias del servicio
(concurrencia) y compara el p99 de los primeros segundos (arranques en frío)
contra el resto de la prueba.
"""
import os
import random

from locust import HttpUser, between, task

JUGADORES = [f"piloto{i:03d}" for i in range(200)]
CABECERAS = {"X-Api-Key": os.environ["SCORE_API_KEY"]} if os.environ.get("SCORE_API_KEY") else {}


class Lector(HttpUser):
    wait_time = between(0.5, 1.5)

    @task(8)                                   # 80 %: consultar la tabla
    def ver_top(self):
        self.client.get("/top", name="GET /top")

    @task(2)                                   # 20 %: registrar un resultado
    def registrar(self):
        self.client.post("/score", name="POST /score", headers=CABECERAS, json={
            "jugador": random.choice(JUGADORES),
            "puntos": random.randint(0, 3000),
            "resultado": random.choice(["victoria", "derrota"]),
        })
