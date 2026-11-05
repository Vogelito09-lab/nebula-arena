"""Prueba de funcionamiento: levanta el servidor real en un puerto libre y
se conecta con clientes WebSocket de verdad (smoke test que usará el CI)."""
import asyncio
import json

import websockets

import server


async def _con_servidor(prueba):
    server.estado.clear()
    server.conexiones.clear()
    server.partida["iniciada"] = False
    async with websockets.serve(server.jugador, "127.0.0.1", 0) as srv:
        puerto = srv.sockets[0].getsockname()[1]
        tick = asyncio.create_task(server.bucle())
        try:
            await asyncio.wait_for(prueba(f"ws://127.0.0.1:{puerto}"), timeout=10)
        finally:
            tick.cancel()


async def _esperar_snapshot_con(ws, jid):
    while True:
        d = json.loads(await ws.recv())
        if "e" in d and jid in d["e"]:
            return d["e"][jid]


def test_ping_pong_y_snapshot():
    async def prueba(url):
        async with websockets.connect(url) as ws:
            await ws.send(json.dumps({"ping": 123.5}))
            while True:
                d = json.loads(await ws.recv())
                if "pong" in d:
                    assert d["pong"] == 123.5
                    break
            await ws.send(json.dumps({"id": "ana", "x": 3, "y": 4, "dispara": False}))
            yo = await _esperar_snapshot_con(ws, "ana")
            assert (yo["x"], yo["y"]) == (3.0, 4.0)
    asyncio.run(_con_servidor(prueba))


def test_mensaje_invalido_no_tumba_la_conexion():
    async def prueba(url):
        async with websockets.connect(url) as ws:
            await ws.send("esto no es json")
            await ws.send(json.dumps({"id": "ana", "x": 999, "y": 1}))
            await ws.send(json.dumps({"id": "ana", "x": 50, "y": 50}))
            yo = await _esperar_snapshot_con(ws, "ana")
            assert yo["x"] == 50.0
    asyncio.run(_con_servidor(prueba))


def test_onceavo_jugador_es_rechazado():
    async def prueba(url):
        clientes = [await websockets.connect(url) for _ in range(10)]
        for i, ws in enumerate(clientes):
            await ws.send(json.dumps({"id": f"j{i}", "x": 1, "y": 1}))
        await asyncio.sleep(0.2)
        assert len(server.conexiones) == 10
        extra = await websockets.connect(url)
        try:
            await extra.recv()
            assert False, "el servidor debió cerrar la conexión"
        except websockets.ConnectionClosed as e:
            assert e.rcvd.code == 4000
        for ws in clientes:
            await ws.close()
    asyncio.run(_con_servidor(prueba))


def test_jugador_que_sale_desaparece_del_estado():
    async def prueba(url):
        async with websockets.connect(url) as ws:
            await ws.send(json.dumps({"id": "ana", "x": 1, "y": 1}))
            await _esperar_snapshot_con(ws, "ana")
        await asyncio.sleep(0.2)
        assert "ana" not in server.estado
        assert not server.conexiones
    asyncio.run(_con_servidor(prueba))
