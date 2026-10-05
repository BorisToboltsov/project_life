# Архитектура

Карта устройства. Правила и запреты — в [INVARIANTS.md](INVARIANTS.md), причины крупных
выборов — в [adr/](adr/).

## Стек

| Слой | Технологии |
|------|------------|
| Бэкенд | Python 3.14, FastAPI, Pydantic v2, SQLAlchemy 2 (async, psycopg 3), Alembic |
| База | PostgreSQL 18 |
| Фронтенд | TypeScript, React 19, Vite, Tailwind CSS 4, shadcn/ui, TanStack Query и Router, i18next |
| PWA | vite-plugin-pwa (Workbox): манифест и service worker с предкэшем оболочки |
| Веб-сервер | Caddy: HTTPS, статика фронтенда, прокси `/api` на бэкенд |
| Инструменты | uv, ruff, pyright, pytest · pnpm, oxlint, prettier, vitest, Playwright |

## Граница фронтенда и бэкенда

Единственный канал — HTTP JSON API под префиксом `/api`. Контракт описывает OpenAPI,
который отдаёт сам бэкенд (`/api/openapi.json`, Swagger UI — `/api/docs`). Из него
генерируются типы фронтенда (`frontend/src/api/schema.d.ts`), запросы идут через
типизированный клиент `openapi-fetch`.

Фронтенд и API живут на одном origin: Caddy отдаёт статику и проксирует `/api/*`. CORS не
нужен.

## Контейнеры

Стенд описан в `deploy/compose.yaml`.

| Сервис | Образ | Роль |
|--------|-------|------|
| `db` | `postgres:18` | данные; том `db` |
| `migrate` | образ бэкенда | разово выполняет `alembic upgrade head` и завершается |
| `backend` | `backend/Dockerfile` | API на uvicorn; стартует после успешных миграций; порт наружу не публикуется |
| `web` | `frontend/Dockerfile` | Caddy со сборкой фронтенда; единственный сервис с открытыми портами |

Адрес сайта задаёт переменная `SITE_ADDRESS`: домен на сервере (сертификат Caddy получает
сам) или `:80` на стенде для e2e.

## Бэкенд

- `app.main` — фабрика приложения, подключение роутеров.
- `app.config` — настройки из окружения с префиксом `LIFE_`.
- `app.db` — движок, фабрика сессий, базовый класс моделей с соглашением об именах
  ограничений.
- `app.log` — логи одной JSON-строкой на запись, включая логи uvicorn.
- `app.api.*` — роутеры. Сейчас один: `GET /api/health` проверяет базу и отдаёт версию.

## Фронтенд

- `src/main.tsx` — точка входа: провайдеры, регистрация service worker.
- `src/app/router.tsx` — дерево маршрутов.
- `src/api/` — сгенерированные типы, клиент и хуки запросов.
- `src/i18n/` — словари и выбор языка (сохраняется в `localStorage`, по умолчанию — язык
  браузера).
- `src/components/ui/` — компоненты shadcn/ui, добавляются из реестра как есть.
- `src/pages/` — экраны.

## Дерево каталогов

```
backend/
  src/app/            код приложения
  migrations/         окружение и версии Alembic
  tests/              тесты; tests/guards/ — гейты
  scripts/            export_openapi.py
frontend/
  src/                код приложения
  e2e/                сквозные тесты Playwright
  public/             иконки PWA (генерируются из logo.svg: pnpm icons)
  Caddyfile           конфигурация веб-сервера, вшивается в образ
deploy/
  compose.yaml        стенд целиком
  .env.example        образец настроек сервера
  e2e.env             настройки стенда для e2e
scripts/              гейты уровня репозитория
docs/                 документация (карта — в CLAUDE.md)
compose.dev.yaml      база для разработки
Makefile              единая точка входа
```
