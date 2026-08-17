.PHONY: up down clean logs generate-card

up:
	docker compose up

down:
	docker compose down -v

generate-card: 
	docker compose up --no-deps producer-card