"""Regresión: el espectador que manda pings no debe ser desconectado.

Antes, el servidor no leía los mensajes del espectador; el cliente manda un ping
por segundo, la cola de entrada (32) se llenaba, el keepalive dejaba de
procesarse y la conexión se cerraba con 1011 al minuto.
"""
import asyncio
import json

import websockets

import server


def test_espectador_con_pings_sigue_conectado_y_recibe_pong():
    async def prueba():
        server.estado.clear(); server.conexiones.clear(); server.espectadores.clear()
        server.motor.reiniciar(0.0)
        async with websockets.serve(server.jugador, "127.0.0.1", 0,
                                    ping_interval=0.5, ping_timeout=0.5) as srv:
            puerto = srv.sockets[0].getsockname()[1]
            tick = asyncio.create_task(server.bucle())
            try:
                async with websockets.connect(f"ws://127.0.0.1:{puerto}/espectador") as esp:
                    assert "bienvenida" in json.loads(await esp.recv())
                    pongs = 0
                    for i in range(60):                 # más que la cola de 32
                        await esp.send(json.dumps({"ping": i}))
                        await esp.send("no es json")    # basura: se ignora
                    fin = asyncio.get_running_loop().time() + 3   # varios keepalive
                    while asyncio.get_running_loop().time() < fin:
                        d = json.loads(await esp.recv())
                        pongs += "pong" in d
                    assert pongs == 60
                    assert esp.open and len(server.espectadores) == 1
            finally:
                tick.cancel()
                server.motor.terminar_exhibicion()
    asyncio.run(asyncio.wait_for(prueba(), 15))
