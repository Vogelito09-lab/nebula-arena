FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY matchmaker.py .
EXPOSE 8080
USER 1000
CMD ["gunicorn", "-b", "0.0.0.0:8080", "-w", "2", "--threads", "4", "matchmaker:app"]
