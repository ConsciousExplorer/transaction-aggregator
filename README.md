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

```
docker compose run --rm --entrypoint sh migrate
```
