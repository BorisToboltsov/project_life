# Единая точка входа: `make check` — полный прогон всех гейтов.

COMPOSE_DEV := docker compose -f compose.dev.yaml
COMPOSE_E2E := docker compose -p life-e2e -f deploy/compose.yaml --env-file deploy/e2e.env
OPENAPI_TMP := frontend/node_modules/.tmp

.PHONY: install db dev-backend dev-frontend admin-invite api-client version stand stand-down \
        check check-version check-backend check-api-client check-frontend e2e clean

install: ## Поставить зависимости бэкенда и фронтенда
	cd backend && uv sync
	cd frontend && pnpm install
	cd frontend && pnpm exec playwright install chromium

db: ## Поднять базу для разработки и тестов
	$(COMPOSE_DEV) up -d --wait

dev-backend: db ## Бэкенд с автоперезагрузкой на :8000
	cd backend && uv run alembic upgrade head && uv run uvicorn app.main:app --reload

admin-invite: db ## Ссылка-приглашение для первого администратора (база разработки)
	cd backend && uv run alembic upgrade head && uv run python -m app.cli invite --admin

dev-frontend: ## Фронтенд на :5173, /api проксируется на бэкенд
	cd frontend && pnpm dev

api-client: ## Перегенерировать TS-типы API из OpenAPI бэкенда
	mkdir -p $(OPENAPI_TMP)
	cd backend && uv run python scripts/export_openapi.py > ../$(OPENAPI_TMP)/openapi.json
	cd frontend && pnpm api-client

version: ## Поднять версию: make version V=0.1.0
	@test -n "$(V)" || (echo "укажите версию: make version V=0.1.0" && exit 1)
	cd backend && uv version $(V)
	cd frontend && npm pkg set version=$(V)

check: check-version check-backend check-api-client check-frontend e2e ## Полный прогон

check-version:
	cd backend && uv run python ../scripts/check_version.py

check-backend: db
	cd backend && uv run ruff format --check .
	cd backend && uv run ruff check .
	cd backend && uv run pyright
	cd backend && uv run pytest

check-api-client: ## Сгенерированные типы API обязаны совпадать с бэкендом
	mkdir -p $(OPENAPI_TMP)
	cd backend && uv run python scripts/export_openapi.py > ../$(OPENAPI_TMP)/openapi.json
	cd frontend && pnpm exec openapi-typescript node_modules/.tmp/openapi.json -o node_modules/.tmp/schema.d.ts
	diff -u frontend/src/api/schema.d.ts $(OPENAPI_TMP)/schema.d.ts

check-frontend:
	cd frontend && pnpm format:check
	cd frontend && pnpm lint
	cd frontend && pnpm typecheck
	cd frontend && pnpm test
	cd frontend && pnpm build

stand: ## Собрать и поднять стенд целиком на http://localhost:8080
	$(COMPOSE_E2E) up -d --build --wait

stand-down: ## Погасить стенд вместе с его данными
	$(COMPOSE_E2E) down -v

e2e: stand ## Сквозной смоук против собранного стенда
	cd frontend && pnpm e2e; status=$$?; cd .. && $(COMPOSE_E2E) down -v; exit $$status

clean: ## Убрать всё, что оставил прогон
	-$(COMPOSE_E2E) down -v
	rm -rf backend/.pytest_cache backend/.ruff_cache backend/.coverage
	rm -rf frontend/dist frontend/coverage frontend/playwright-report frontend/test-results
