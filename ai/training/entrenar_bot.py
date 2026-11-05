"""Práctica 3.1 — Entrenar y servir un bot sencillo.

Entrena un agente PPO (Stable-Baselines3) en CartPole-v1, mide la latencia de
inferencia en CPU y calcula cuántas vCPU harían falta para servir bots en
producción. Guarda el modelo y un JSON con las mediciones.

Uso:
    python entrenar_bot.py --device cpu
    python entrenar_bot.py --device cuda      # en Colab con GPU T4
"""
import argparse
import json
import math
import os
import platform
import sys
import time
from datetime import datetime, timezone

import gymnasium as gym
import numpy as np
import torch
from stable_baselines3 import PPO


def medir_inferencia(modelo, env, n=10_000):
    """Latencia media de modelo.predict en ms (un solo hilo de CPU)."""
    obs, _ = env.reset(seed=0)
    for _ in range(200):                       # calentamiento
        modelo.predict(obs, deterministic=True)
    t = time.perf_counter()
    for _ in range(n):
        accion, _ = modelo.predict(obs, deterministic=True)
    return (time.perf_counter() - t) / n * 1000


def evaluar(modelo, env, episodios=10):
    """Recompensa media: CartPole-v1 llega como máximo a 500."""
    total = []
    for ep in range(episodios):
        obs, _ = env.reset(seed=ep)
        fin, suma = False, 0.0
        while not fin:
            accion, _ = modelo.predict(obs, deterministic=True)
            obs, r, term, trunc, _ = env.step(accion)
            suma += r
            fin = term or trunc
        total.append(suma)
    return float(np.mean(total))


def vcpu_necesarias(bots, hz, decisiones_por_nucleo, margen=0.30):
    decisiones = bots * hz
    base = decisiones / decisiones_por_nucleo
    return decisiones, base, math.ceil(base * (1 + margen))


def main():
    sys.stdout.reconfigure(encoding="utf-8")   # la consola de Windows usa cp1252
    p = argparse.ArgumentParser()
    p.add_argument("--device", default="cpu", choices=["cpu", "cuda", "auto"])
    p.add_argument("--timesteps", type=int, default=100_000)
    p.add_argument("--bots", type=int, default=2_000)
    p.add_argument("--hz", type=int, default=10)
    p.add_argument("--salida", default="resultados")
    a = p.parse_args()

    if a.device == "cuda" and not torch.cuda.is_available():
        raise SystemExit("No hay GPU CUDA disponible: en Colab activa "
                         "Entorno de ejecución → Cambiar tipo → GPU T4")

    os.makedirs(a.salida, exist_ok=True)
    env = gym.make("CartPole-v1")
    modelo = PPO("MlpPolicy", env, verbose=0, device=a.device, seed=0)
    dispositivo = str(modelo.device)

    inicio = time.time()
    modelo.learn(total_timesteps=a.timesteps)
    t_entreno = time.time() - inicio
    print(f"Entrenamiento ({dispositivo}): {t_entreno:.1f} s")

    nombre = f"bot_nebula_{dispositivo.split(':')[0]}"
    modelo.save(os.path.join(a.salida, nombre))

    recompensa = evaluar(modelo, env)
    print(f"Recompensa media en 10 episodios: {recompensa:.1f} / 500")

    # La inferencia se mide siempre en CPU y con un solo hilo, porque la
    # pregunta es "cuántas decisiones por segundo da UN núcleo".
    torch.set_num_threads(1)
    modelo_cpu = PPO.load(os.path.join(a.salida, nombre), device="cpu")
    lat_ms = medir_inferencia(modelo_cpu, env)
    por_nucleo = 1000 / lat_ms
    decisiones, base, vcpu = vcpu_necesarias(a.bots, a.hz, por_nucleo)
    print(f"Latencia media: {lat_ms:.3f} ms → {por_nucleo:,.0f} decisiones/s por núcleo")
    print(f"{a.bots} bots × {a.hz} Hz = {decisiones:,} inferencias/s → "
          f"{base:.2f} vCPU + 30 % de margen ≈ {vcpu} vCPU")

    res = {
        "fecha_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "maquina": {
            "sistema": platform.platform(),
            "cpu": platform.processor() or platform.machine(),
            "nucleos_logicos": os.cpu_count(),
            "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
            "torch": torch.__version__,
        },
        "dispositivo_entrenamiento": dispositivo,
        "timesteps": a.timesteps,
        "tiempo_entrenamiento_s": round(t_entreno, 2),
        "recompensa_media": recompensa,
        "latencia_inferencia_ms": round(lat_ms, 4),
        "decisiones_por_s_por_nucleo": round(por_nucleo),
        "dimensionamiento": {
            "bots": a.bots, "hz": a.hz, "inferencias_por_s": decisiones,
            "vcpu_sin_margen": round(base, 2), "vcpu_con_30_margen": vcpu,
        },
    }
    archivo = os.path.join(a.salida, f"resultados_{dispositivo.split(':')[0]}.json")
    with open(archivo, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=2, ensure_ascii=False)
    print(f"Guardado: {archivo}")


if __name__ == "__main__":
    main()
