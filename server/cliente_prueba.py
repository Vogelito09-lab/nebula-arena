"""Cliente de prueba: conecta N jugadores a un servidor y mide el RTT con ping.

No es la prueba de carga (esa es Locust en la práctica 3.4): sirve para
comprobar a mano que una imagen o un GameServer responde.

    python cliente_prueba.py --url ws://localhost:7654 --jugadores 10 --segundos 10
"""
import argparse
import asyncio
import json
import random
import statistics
import time

import websockets


async def jugador(url, i, segundos, rtts):
    jid = f"prueba{i}"
    x, y = random.uniform(10, 90), random.uniform(10, 90)
    async with websockets.connect(url) as ws:
        fin = time.perf_counter() + segundos
        n = 0
        while time.perf_counter() < fin:
            x = min(100, max(0, x + random.uniform(-1, 1)))
            y = min(100, max(0, y + random.uniform(-1, 1)))
            await ws.send(json.dumps({"id": jid, "x": x, "y": y,
                                      "dispara": random.random() < 0.1}))
            n += 1
            if n % 20 == 0:                       # un ping por segundo
                t0 = time.perf_counter()
                await ws.send(json.dumps({"ping": t0}))
                while json.loads(await ws.recv()).get("pong") != t0:
                    pass                          # descarta snapshots acumulados
                rtts.append((time.perf_counter() - t0) * 1000)
            await asyncio.sleep(0.05)             # 20 mensajes por segundo


def percentil(datos, p):
    datos = sorted(datos)
    k = max(0, min(len(datos) - 1, round(p / 100 * len(datos)) - 1))
    return datos[k]


async def main():
    a = argparse.ArgumentParser()
    a.add_argument("--url", default="ws://localhost:7654")
    a.add_argument("--jugadores", type=int, default=10)
    a.add_argument("--segundos", type=int, default=10)
    o = a.parse_args()
    rtts = []
    await asyncio.gather(*(jugador(o.url, i, o.segundos, rtts)
                           for i in range(o.jugadores)))
    print(f"{o.jugadores} jugadores, {o.segundos} s, {len(rtts)} pings")
    print(f"RTT p50={statistics.median(rtts):.2f} ms  p95={percentil(rtts, 95):.2f} ms  "
          f"p99={percentil(rtts, 99):.2f} ms")


if __name__ == "__main__":
    asyncio.run(main())
