# transaction-aggregator

A transaction aggregation project


# Getting started

Everything runs through `make` from the repo root; the compose file lives in
`infrastructure/docker-compose.yaml`.

```
make up          # the whole system, producers included (dev UIs too; `make up UI=` skips them)
make generate    # run all five producers again (GENERATOR_SEED=42 make generate for a fixed seed)
make logs        # follow the logs
make ps          # container status
make down        # stop and remove containers, keep the data
make clean       # stop and delete the volumes too: the next `make up` starts empty
```

# Generate DBML schema
```
npm install -g @dbml/cli
make db-diagram
```

