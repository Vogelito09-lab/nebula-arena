# Cloud Run puede construirla con "gcloud run deploy --source ." (usa este Dockerfile).
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .
ENV PORT=8080
USER 1000
CMD exec gunicorn -b 0.0.0.0:$PORT -w 1 --threads 8 --timeout 0 main:app
