.PHONY: install run test lint audit up down migrate
install:
	pip install -r requirements/dev.txt
run:
	DJANGO_DEBUG=1 python manage.py runserver
migrate:
	DJANGO_DEBUG=1 python manage.py migrate
test:
	DJANGO_TESTING=1 pytest
lint:
	ruff check . && ruff format --check . && bandit -q -c pyproject.toml -r apps config
audit:
	pip-audit -r requirements/base.txt
up:
	docker compose up --build
down:
	docker compose down
