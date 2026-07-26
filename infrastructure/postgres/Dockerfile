FROM postgres:18

# Install build tools, server development headers, and pg_partman via apt
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        postgresql-18-partman && \
    rm -rf /var/lib/apt/lists/*