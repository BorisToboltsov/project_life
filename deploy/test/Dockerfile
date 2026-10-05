# «Сервер» для проверки скриптов выкладки: Ubuntu 24.04, как на настоящем, с клиентом Docker.
# Демон Docker берётся с машины, на которой идёт проверка (сокет монтируется при запуске).
FROM ubuntu:24.04
RUN apt-get update \
    && apt-get install -y --no-install-recommends age ca-certificates curl iproute2 openssl systemd \
    && rm -rf /var/lib/apt/lists/*
COPY --from=docker:cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
