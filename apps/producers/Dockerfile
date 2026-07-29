FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

# Using PYTHONBUFFERED to ensure logs are kept on startup
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# README.md is required: pyproject.toml references it as the package readme
COPY pyproject.toml uv.lock README.md ./
COPY src/ src/
COPY schemas/ schemas/

# --no-cache: don't keep uv's wheel cache in the layer (halves the image)
RUN uv sync --frozen --no-dev --no-cache

CMD ["uv", "run", "--no-sync", "start"]
