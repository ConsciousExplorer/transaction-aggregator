.PHONY: up down clean logs generate-card generate-eft

up:
	docker compose up

down:
	docker compose down -v

generate-card: 
	docker compose up --no-deps producer-card

generate-eft: 
	docker compose up --no-deps producer-eft