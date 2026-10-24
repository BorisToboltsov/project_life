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

FROM postgres:18 AS postgres-tools
FROM python:3.14-slim
RUN apt-get update && apt-get install -y --no-install-recommends age libpq5 liblz4-1 libzstd1 && rm -rf /var/lib/apt/lists/*
COPY --from=postgres-tools /usr/lib/postgresql/18/bin/pg_dump /usr/local/bin/pg_dump
COPY --from=postgres-tools /usr/lib/postgresql/18/bin/psql /usr/local/bin/psql
COPY --from=postgres-tools /usr/lib/*/libpq.so.5* /usr/local/lib/
ENV LD_LIBRARY_PATH="/usr/local/lib"
RUN psql --version && pg_dump --version
RUN useradd --system --uid 10001 --no-create-home app && mkdir /scratch && chown app /scratch
WORKDIR /srv
COPY --from=build /srv/.venv ./.venv
COPY alembic.ini ./
COPY migrations ./migrations
ENV PATH="/srv/.venv/bin:$PATH" PYTHONUNBUFFERED=1 LIFE_ENVIRONMENT=prod
USER app
EXPOSE 8000
# Порт наружу не публикуется: заголовки X-Forwarded-* приходят только от Caddy.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
