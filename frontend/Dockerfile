FROM node:24-slim AS build
RUN corepack enable
WORKDIR /src
# Зависимости отдельным слоем: он пересобирается только при смене lock-файла.
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/dist /srv
