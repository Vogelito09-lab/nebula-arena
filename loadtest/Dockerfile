# Generador de carga. En la nube el material lo corre en una VM (e2-standard-8)
# de la misma región; en local se corre como contenedor dentro de la red "kind"
# para alcanzar las IPs de los GameServers.
FROM python:3.11-slim
WORKDIR /loadtest
RUN pip install --no-cache-dir locust==2.32.4 websocket-client==1.8.0
COPY locustfile.py .
ENTRYPOINT ["locust", "-f", "locustfile.py"]
