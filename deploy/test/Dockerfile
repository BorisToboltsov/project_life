# «Сервер» для проверки скриптов выкладки: Ubuntu 24.04 с теми же пакетами, что ставит
# docs/INSTALL.md, — клиент Docker и плагин compose из репозитория Ubuntu, age.
# Демон Docker берётся с машины, на которой идёт проверка (сокет монтируется при запуске).
FROM ubuntu:24.04
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        age ca-certificates curl docker.io docker-compose-v2 iproute2 openssl systemd \
    && rm -rf /var/lib/apt/lists/*
