"""Práctica 3.4, paso 5 — Gráficas y números del reporte a partir de una prueba.

Junta dos fuentes:
  - el historial de Locust (<prefijo>_stats_history.csv): usuarios y RTT p95,
  - Prometheus (API de rango): CCU, servidores por estado, nodos y réplicas del HPA.

Genera en loadtest/reports/<prefijo>/:
  ccu_vs_p95.png            jugadores concurrentes vs latencia RTT p95
  ccu_vs_servidores.png     jugadores concurrentes vs servidores activos
  reaccion_autoescalado.png línea de tiempo usuarios / Ready / Allocated / nodos / HPA
  resumen.json              capacidad, tiempos de reacción y errores

Uso (con Prometheus accesible, por ejemplo con
 kubectl port-forward -n monitoring svc/monitoreo-kube-prometheus-prometheus 9090):
  python analizar.py --prefijo rampa --prometheus http://localhost:9090
"""
import argparse
import json
import math
import os
import sys
import urllib.parse
import urllib.request

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt   # noqa: E402
import pandas as pd               # noqa: E402

META_P95_MS = 80


def consultar(prom, expr, inicio, fin, paso=5):
    q = urllib.parse.urlencode({"query": expr, "start": inicio, "end": fin, "step": paso})
    with urllib.request.urlopen(f"{prom}/api/v1/query_range?{q}", timeout=30) as r:
        res = json.load(r)["data"]["result"]
    series = {}
    for s in res:
        etiqueta = s["metric"].get("type") or s["metric"].get("__name__") or "valor"
        series[etiqueta] = pd.Series({int(float(t)): float(v) for t, v in s["values"]})
    return pd.DataFrame(series)


def primer_cruce(serie, umbral):
    """Primer timestamp en que la serie llega al umbral (o None)."""
    sobre = serie[serie >= umbral]
    return int(sobre.index[0]) if len(sobre) else None


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    a = argparse.ArgumentParser()
    a.add_argument("--prefijo", required=True, help="prefijo de --csv de Locust (p. ej. rampa)")
    a.add_argument("--dir", default="reports", help="carpeta donde están los CSV")
    a.add_argument("--prometheus", default="http://localhost:9090")
    a.add_argument("--etiqueta", default="", help="texto para los títulos (p. ej. 'kind local')")
    o = a.parse_args()

    salida = os.path.join(o.dir, o.prefijo)
    os.makedirs(salida, exist_ok=True)
    h = pd.read_csv(os.path.join(o.dir, f"{o.prefijo}_stats_history.csv"))
    rtt = h[h["Name"] == "rtt"].copy()
    rtt["p95"] = pd.to_numeric(rtt["95%"], errors="coerce")
    rtt = rtt.dropna(subset=["p95"])
    inicio, fin = int(h["Timestamp"].min()), int(h["Timestamp"].max())
    usuarios = h[h["Name"] == "Aggregated"].set_index("Timestamp")["User Count"]

    # --- Prometheus
    ccu = consultar(o.prometheus, "sum(nebula_players_connected)", inicio, fin)
    estados = consultar(o.prometheus,
                        'sum by (type) (agones_gameservers_count{fleet_name="nebula-fleet"})',
                        inicio, fin)
    nodos = consultar(o.prometheus, "count(kube_node_info)", inicio, fin)
    hpa = consultar(o.prometheus, 'kube_horizontalpodautoscaler_status_current_replicas'
                    '{horizontalpodautoscaler="matchmaker-hpa"}', inicio, fin)
    for nombre, df in [("ccu", ccu), ("servidores", estados), ("nodos", nodos), ("hpa", hpa)]:
        df.to_csv(os.path.join(salida, f"prometheus_{nombre}.csv"), index_label="timestamp")

    titulo = f" ({o.etiqueta})" if o.etiqueta else ""

    # 1. CCU vs p95
    plt.figure(figsize=(8, 5))
    plt.scatter(rtt["User Count"], rtt["p95"], s=10)
    plt.yscale("log")
    plt.axhline(META_P95_MS, linestyle="--", color="red", label=f"meta p95 = {META_P95_MS} ms")
    plt.xlabel("Jugadores simulados (usuarios de Locust)"); plt.ylabel("RTT p95 (ms, escala log)")
    plt.title("Jugadores concurrentes vs latencia p95" + titulo)
    plt.legend(); plt.grid(alpha=.3); plt.tight_layout()
    plt.savefig(os.path.join(salida, "ccu_vs_p95.png"), dpi=150); plt.close()

    # 2. CCU vs servidores activos
    activos = estados.sum(axis=1) - estados.get("Shutdown", 0)
    juntos = pd.DataFrame({"ccu": ccu.iloc[:, 0] if len(ccu.columns) else pd.Series(dtype=float),
                           "activos": activos}).dropna()
    plt.figure(figsize=(8, 5))
    plt.plot(juntos["ccu"], juntos["activos"], marker=".", linewidth=1)
    plt.xlabel("Jugadores conectados (CCU, Prometheus)"); plt.ylabel("GameServers activos")
    plt.title("Jugadores concurrentes vs servidores activos" + titulo)
    plt.grid(alpha=.3); plt.tight_layout()
    plt.savefig(os.path.join(salida, "ccu_vs_servidores.png"), dpi=150); plt.close()

    # 3. Línea de tiempo del autoescalado
    fig, ax1 = plt.subplots(figsize=(10, 5))
    t = lambda idx: [(i - inicio) for i in idx]
    ax1.plot(t(usuarios.index), usuarios.values, label="usuarios Locust", color="black")
    ax1.plot(t(ccu.index), ccu.iloc[:, 0] if len(ccu.columns) else [], label="CCU", color="gray", linestyle=":")
    ax1.set_xlabel("segundos desde el inicio"); ax1.set_ylabel("jugadores")
    ax2 = ax1.twinx()
    for col in [c for c in ["Ready", "Allocated", "Shutdown"] if c in estados.columns]:
        ax2.plot(t(estados.index), estados[col], label=f"GS {col}")
    if len(nodos.columns):
        ax2.plot(t(nodos.index), nodos.iloc[:, 0], label="nodos", linestyle="--")
    if len(hpa.columns):
        ax2.plot(t(hpa.index), hpa.iloc[:, 0], label="réplicas matchmaker", linestyle="-.")
    ax2.set_ylabel("servidores / nodos / réplicas")
    l1, n1 = ax1.get_legend_handles_labels(); l2, n2 = ax2.get_legend_handles_labels()
    ax1.legend(l1 + l2, n1 + n2, loc="upper left", fontsize=8)
    plt.title("Tiempo de reacción del autoescalado" + titulo); fig.tight_layout()
    plt.savefig(os.path.join(salida, "reaccion_autoescalado.png"), dpi=150); plt.close()

    # --- Resumen numérico
    agg = pd.read_csv(os.path.join(o.dir, f"{o.prefijo}_stats.csv"))
    filas = {r["Name"]: r for _, r in agg.iterrows()}
    # Capacidad: usuarios en el primer momento en que el p95 se queda arriba de
    # la meta 15 s seguidos (un pico aislado al conectar no cuenta).
    rtt_t = rtt.set_index("Timestamp")
    sobre = (rtt_t["p95"] > META_P95_MS).astype(int)
    racha = sobre.groupby((sobre != sobre.shift()).cumsum()).cumsum()
    sostenido = racha[racha >= 15]
    capacidad = (int(rtt_t.loc[sostenido.index[0], "User Count"]) if len(sostenido)
                 else None)
    # Reacción del autoescalado:
    #  - primer escalado: desde que llega carga hasta que la flota (Ready+Allocated)
    #    supera su tamaño inicial;
    #  - tiempo sin buffer: % de muestras con 0 servidores Ready mientras había carga
    #    (un jugador que pide partida en ese momento recibe 503 y espera).
    usuarios_max = int(usuarios.max())
    necesarios = math.ceil(usuarios_max / 10)
    t_carga = primer_cruce(usuarios, 1)
    vivos = estados.reindex(columns=["Ready", "Allocated"]).fillna(0).sum(axis=1)
    inicial = float(vivos.iloc[0]) if len(vivos) else 0
    t_escala = primer_cruce(vivos, inicial + 1)
    con_carga = estados.index >= (t_carga or inicio)
    ready = estados["Ready"] if "Ready" in estados else pd.Series(0, index=estados.index)
    sin_buffer = float((ready[con_carga] == 0).mean()) if con_carga.any() else None
    max_ready = float(estados["Ready"].max()) if "Ready" in estados else None
    nodos_max = float(nodos.iloc[:, 0].max()) if len(nodos.columns) else None
    resumen = {
        "prefijo": o.prefijo, "etiqueta": o.etiqueta,
        "inicio_unix": inicio, "fin_unix": fin, "duracion_s": fin - inicio,
        "usuarios_max": usuarios_max,
        "ccu_max_prometheus": float(ccu.iloc[:, 0].max()) if len(ccu.columns) else None,
        "rtt": {k: float(filas["rtt"][k]) for k in ["50%", "95%", "99%", "Average Response Time"]} if "rtt" in filas else None,
        "rtt_peticiones": int(filas["rtt"]["Request Count"]) if "rtt" in filas else 0,
        "rtt_fallos": int(filas["rtt"]["Failure Count"]) if "rtt" in filas else 0,
        "asignacion_peticiones": int(filas["asignacion"]["Request Count"]) if "asignacion" in filas else 0,
        "asignacion_fallos": int(filas["asignacion"]["Failure Count"]) if "asignacion" in filas else 0,
        "conexion_fallos": int(filas["conexion"]["Failure Count"]) if "conexion" in filas else 0,
        "desconexiones": int(filas["desconexion"]["Failure Count"]) if "desconexion" in filas else 0,
        "capacidad_usuarios_p95_sobre_80ms_15s": capacidad,
        "servidores_allocated_necesarios": necesarios,
        "segundos_hasta_primer_escalado_de_flota": (t_escala - t_carga) if (t_escala and t_carga) else None,
        "fraccion_del_tiempo_sin_servidores_ready": round(sin_buffer, 3) if sin_buffer is not None else None,
        "servidores_vivos_max": float(vivos.max()) if len(vivos) else None,
        "ready_max": max_ready,
        "allocated_max": float(estados["Allocated"].max()) if "Allocated" in estados else None,
        "nodos_max": nodos_max,
        "replicas_hpa_max": float(hpa.iloc[:, 0].max()) if len(hpa.columns) else None,
    }
    with open(os.path.join(salida, "resumen.json"), "w", encoding="utf-8") as f:
        json.dump(resumen, f, indent=2, ensure_ascii=False)
    print(json.dumps(resumen, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
