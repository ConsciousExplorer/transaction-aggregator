.PHONY: up down clean logs

up:
	docker compose up

down:
	docker compose down -v