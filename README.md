# transaction-aggregator

A transaction aggregation project

# Getting started

Start all the services

```
docker compose up
```

# Start an individual producer

```
docker compose up --no-deps producer-card
```

# Get a shell inside flyway

Change the entrypoint and run commands
```
docker compose run --rm --entrypoint sh migrate
```
Running commands directly against the flyway image
```
docker compose run --rm migrate info
docker compose run --rm migrate migrate
docker compose run --rm migrate validate
docker compose run --rm migrate repair
```

# Generate DBML schema
```
npm install -g @dbml/cli

make db-diagram
```

