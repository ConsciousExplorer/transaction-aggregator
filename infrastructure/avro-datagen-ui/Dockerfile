FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

ENV PYTHONUNBUFFERED=1

# [ui] extra pulls Streamlit; pin floor matches apps/producers' pyproject.
RUN uv pip install --system --no-cache "avro-datagen[ui]>=0.5.0,<0.6"

# Bind avro schemas
ENV SCHEMA_DIR=/schemas \
    STREAMLIT_SERVER_HEADLESS=true \
    STREAMLIT_SERVER_ADDRESS=0.0.0.0

CMD ["sh", "-c", "exec avro-datagen ui --schema-dir \"$SCHEMA_DIR\" --port \"${PORT:-8501}\""]
