.PHONY: up up-all down clean logs ps produce produce-card produce-eft produce-loan produce-internal-transfer produce-debit-order produce-card-v2 produce-stream produce-load-data db-diagram migrate load

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
ANCHOR_DATE ?= 2026-10-21

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
produce:
	$(COMPOSE) up --no-deps producer-card producer-eft producer-loan producer-internal-transfer producer-debit-order

produce-card:
	$(COMPOSE) up --no-deps producer-card

produce-eft:
	$(COMPOSE) up --no-deps producer-eft

produce-loan:
	$(COMPOSE) up --no-deps producer-loan

produce-internal-transfer:
	$(COMPOSE) up --no-deps producer-internal-transfer

produce-debit-order:
	$(COMPOSE) up --no-deps producer-debit-order

# Rolls out card schema version 2 (schemas/v2/card.avsc, which adds
# merchantCountry) producer-first, on a stack that is already up: it registers
# version 2, then sends CARD_V2_COUNT records written with it. consumer-card
# only loaded version 1 when it started, so it stops on the first new schema id,
# restarts, loads both versions and stores the records. make clean wipes the
# registry, so the next make up is back on version 1.
CARD_V2_COUNT ?= 100
produce-card-v2:
	$(COMPOSE) run --rm --no-deps -e SCHEMAS_DIR=/schemas/v2 schemas-register
	$(COMPOSE) run --rm --no-deps -e GENERATOR_SCHEMA_PATH=/schemas/v2/card.avsc -e GENERATOR_COUNT=$(CARD_V2_COUNT) producer-card

# Live transactions until Ctrl-C, stamped with the time they are sent, at a retail
# bank's mix per second: card 25, eft 8, debit-order 4, internal-transfer 2, loan 1
# (defaults in compose). Override one: make produce-stream CARD_RATE=100
produce-stream:
	PRODUCER_MODE=stream $(COMPOSE) up --build --no-deps producer-card producer-eft producer-loan producer-internal-transfer producer-debit-order

# About 5M more transactions, so the load test runs on the 5M-row database its
# latency target assumes (make up loads 280,000). Sent through the pipeline in
# the stream's mix (card 25 : eft 8 : debit-order 4 : internal-transfer 2 :
# loan 1), with a fresh seed so none repeat what is stored, and history ending
# on ANCHOR_DATE like make up, so the load test's windows hold them. The
# consumers keep inserting after the producers exit: wait for them before
# make load.
produce-load-data:
	GENERATOR_ANCHOR_DATE=$(ANCHOR_DATE) \
	CARD_COUNT=3125000 EFT_COUNT=1000000 DEBIT_ORDER_COUNT=500000 \
	INTERNAL_TRANSFER_COUNT=250000 LOAN_COUNT=125000 \
	$(COMPOSE) up --no-deps producer-card producer-eft producer-loan producer-internal-transfer producer-debit-order

db-diagram:
	@chmod +x ./scripts/db-diagram.sh
	@./scripts/db-diagram.sh

# Re-runs the migrate one-shot; already-applied files are skipped. No command
# argument: one would replace the image's CMD (npx drizzle-kit migrate).
migrate:
	$(COMPOSE) run --rm migrate

# k6 load test (k6 on the host): randomised portal user sessions against the
# API, arriving at a fixed rate. LOAD_PROFILE=smoke checks the script, load
# holds 50 req/s for 10 min with p95 under 200 ms, breakpoint steps the rate up
# until the API is clearly past its limit. The API is recreated at LOG_LEVEL
# info with tracing off, so neither costs throughput (make load
# OTEL_SDK_DISABLED=false keeps traces); it stays that way until the next make
# up. The customer ids come from Postgres. Live charts on http://127.0.0.1:5665
# during the run; the same report is saved in loadtests/results/.
LOAD_PROFILE ?= load
load:
	API_LOG_LEVEL=info $(COMPOSE) up -d --no-deps --wait api
	$(COMPOSE) exec -T postgres psql -U postgres -d txn_agg -At -c "SELECT DISTINCT user_id FROM txn_agg.transactions" > loadtests/users.txt
	@mkdir -p loadtests/results
	K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=loadtests/results/$(LOAD_PROFILE)-$$(date +%Y%m%d-%H%M%S).html k6 run -e LOAD_PROFILE=$(LOAD_PROFILE) -e ANCHOR_DATE=$(ANCHOR_DATE) loadtests/user-sessions.ts
