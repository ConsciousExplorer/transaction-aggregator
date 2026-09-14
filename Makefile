.PHONY: up down clean logs generate generate-card generate-eft generate-loan generate-internal-transfer generate-debit-order db-diagram migrate

# All five sources in one run (random seeds unless GENERATOR_SEED is set)
generate:
	docker compose up --no-deps producer-card producer-eft producer-loan producer-internal-transfer producer-debit-order

up:
	docker compose up

down:
	docker compose down -v

generate-card: 
	docker compose up --no-deps producer-card

generate-eft: 
	docker compose up --no-deps producer-eft

generate-loan: 
	docker compose up --no-deps producer-loan

generate-internal-transfer: 
	docker compose up --no-deps producer-internal-transfer

generate-debit-order: 
	docker compose up --no-deps producer-debit-order

db-diagram:
	@chmod +x ./scripts/db-diagram.sh
	@./scripts/db-diagram.sh

migrate:
	docker compose run --rm migrate migrate