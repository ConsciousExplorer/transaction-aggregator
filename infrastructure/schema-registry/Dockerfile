FROM python:3.13-alpine

# Using PYTHONUNBUFFERED to ensure logs are kept on startup
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Stdlib-only script: no pip install, no lockfile to sync
COPY register.py .

# Schemas are volume-mounted at /schemas (see docker-compose.yaml) so schema
# edits re-register on the next `docker compose up` without an image rebuild
ENTRYPOINT ["python", "/app/register.py"]
