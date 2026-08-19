.PHONY: up down clean logs generate-card generate-eft

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