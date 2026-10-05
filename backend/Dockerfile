FROM python:3.14-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /srv
# Зависимости отдельным слоем: он пересобирается только при смене lock-файла.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-editable

FROM python:3.14-slim
RUN useradd --system --uid 10001 --no-create-home app
WORKDIR /srv
COPY --from=build /srv/.venv ./.venv
COPY alembic.ini ./
COPY migrations ./migrations
ENV PATH="/srv/.venv/bin:$PATH" PYTHONUNBUFFERED=1 LIFE_ENVIRONMENT=prod
USER app
EXPOSE 8000
# Порт наружу не публикуется: заголовки X-Forwarded-* приходят только от Caddy.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
