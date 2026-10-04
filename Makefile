.PHONY: up up-all down clean logs ps generate generate-card generate-eft generate-loan generate-internal-transfer generate-debit-order db-diagram migrate

# Every compose call goes through here: the compose file lives in infrastructure/
COMPOSE := docker compose -f infrastructure/docker-compose.yaml

# Dev UIs (kafbat-ui, avro-datagen-ui) start by default; `make up UI=` leaves them out
UI ?= 1
PROFILES := $(if $(UI),--profile ui)

# down and clean name every profile, so no profiled container is left behind
ALL_PROFILES := --profile ui --profile obs --profile cache

# make up always sends the same records: a fixed seed, and history ending on a
# fixed day. Change them for one run: make up SEED=7 ANCHOR_DATE=2026-12-01
SEED ?= 42
ANCHOR_DATE ?= 2026-10-04

# The whole system, producers included
up:
	GENERATOR_SEED=$(SEED) GENERATOR_ANCHOR_DATE=$(ANCHOR_DATE) $(COMPOSE) $(PROFILES) up

# Every profile, obs included, so tracing is switched on too (compose defaults
# OTEL_SDK_DISABLED to true; the collector and Tempo only run in this target)
up-all:
	GENERATOR_SEED=$(SEED) GENERATOR_ANCHOR_DATE=$(ANCHOR_DATE) OTEL_SDK_DISABLED=false $(COMPOSE) $(ALL_PROFILES) up

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

# All five sources in one run: random transactions (a fresh seed, history
# ending today) unless the shell sets GENERATOR_SEED / GENERATOR_ANCHOR_DATE.
# Always the same customers and accounts: the schemas seed those pools.
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

# Re-runs the migrate one-shot; already-applied files are skipped. No command
# argument: one would replace the image's CMD (npx drizzle-kit migrate).
migrate:
	$(COMPOSE) run --rm migrate
