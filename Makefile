.PHONY: up up-all down clean logs ps generate generate-card generate-eft generate-loan generate-internal-transfer generate-debit-order db-diagram migrate

# Every compose call goes through here: the compose file lives in infrastructure/
COMPOSE := docker compose -f infrastructure/docker-compose.yaml

# Dev UIs (kafbat-ui, avro-datagen-ui) start by default; `make up UI=` leaves them out
UI ?= 1
PROFILES := $(if $(UI),--profile ui)

# down and clean name every profile, so no profiled container is left behind
ALL_PROFILES := --profile ui --profile obs --profile cache

# The whole system, producers included (random seeds unless GENERATOR_SEED is set)
up:
	$(COMPOSE) $(PROFILES) up

up-all:
	$(COMPOSE) $(ALL_PROFILES) up

# Stops and removes the containers; Kafka and Postgres data are kept
down:
	$(COMPOSE) $(ALL_PROFILES) down

# down, and deletes the volumes too: the next `make up` starts from empty
clean:
	$(COMPOSE) $(ALL_PROFILES) down -v

logs:
	$(COMPOSE) $(PROFILES) logs -f

ps:
	$(COMPOSE) $(ALL_PROFILES) ps

# All five sources in one run (random seeds unless GENERATOR_SEED is set)
generate:
	$(COMPOSE) up --no-deps producer-card producer-eft producer-loan producer-internal-transfer producer-debit-order

generate-card:
	$(COMPOSE) up --no-deps producer-card

generate-eft:
	$(COMPOSE) up --no-deps producer-eft

generate-loan:
	$(COMPOSE) up --no-deps producer-loan

generate-internal-transfer:
	$(COMPOSE) up --no-deps producer-internal-transfer

generate-debit-order:
	$(COMPOSE) up --no-deps producer-debit-order

db-diagram:
	@chmod +x ./scripts/db-diagram.sh
	@./scripts/db-diagram.sh

migrate:
	$(COMPOSE) run --rm migrate migrate
