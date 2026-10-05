#!/usr/bin/env bash
# Ставит или обновляет серверную часть project_life. Запускается от root из клона
# репозитория; подробности и подготовка сервера — в docs/INSTALL.md.
#
#   первый раз:  sudo bash deploy/install.sh life.example.com age1…
#   обновление:  sudo bash deploy/install.sh
#
# Скрипт трогает только свой каталог (/opt/life) и свои юниты systemd. Docker, файрвол и
# сетевые настройки сервера он не меняет.
set -euo pipefail

LIFE_HOME="${LIFE_HOME:-/opt/life}"
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
domain="${1:-}"
recipient="${2:-}"

fail() {
  echo "install: $*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail "запустите от root: sudo bash deploy/install.sh"
command -v docker >/dev/null || fail "не найден docker — см. docs/INSTALL.md"
docker compose version >/dev/null 2>&1 || fail "не найден плагин docker compose — см. docs/INSTALL.md"
command -v age >/dev/null || fail "не найден age: apt install age"
command -v openssl >/dev/null || fail "не найден openssl: apt install openssl"

if [ ! -f "$LIFE_HOME/.env" ]; then
  [ -n "$domain" ] || fail "первый запуск: укажите домен и открытый ключ age — install.sh life.example.com age1…"
  case "$recipient" in
    age1*) ;;
    *) fail "второй аргумент — открытый ключ age, он начинается с «age1»" ;;
  esac
  for port in "${HTTP_PORT:-80}" "${HTTPS_PORT:-443}"; do
    if command -v ss >/dev/null && [ -n "$(ss -Hltn "sport = :$port")" ]; then
      fail "порт $port уже занят другой программой: ss -ltnp 'sport = :$port'"
    fi
  done
fi

install -d -m 755 "$LIFE_HOME" "$LIFE_HOME/bin"
install -d -m 700 "$LIFE_HOME/backups"
install -m 644 "$source_dir/compose.yaml" "$LIFE_HOME/compose.yaml"
install -m 755 "$source_dir/bin/life-update" "$source_dir/bin/life-backup" "$LIFE_HOME/bin/"

if [ ! -f "$LIFE_HOME/.env" ]; then
  # Секреты создаются здесь, на сервере, и никуда не передаются.
  (
    umask 077
    cat >"$LIFE_HOME/.env" <<ENV
SITE_ADDRESS=$domain
PUBLIC_URL=https://$domain
JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 24)
IMAGE_TAG=latest
BACKUP_RECIPIENT=$recipient
BACKUP_KEEP_DAYS=30
BACKUP_REMOTE=
${HTTP_PORT:+HTTP_PORT=$HTTP_PORT}
${HTTPS_PORT:+HTTPS_PORT=$HTTPS_PORT}
${BACKEND_IMAGE:+BACKEND_IMAGE=$BACKEND_IMAGE}
${WEB_IMAGE:+WEB_IMAGE=$WEB_IMAGE}
ENV
  )
fi
chmod 600 "$LIFE_HOME/.env"

if command -v systemctl >/dev/null && [ -d /run/systemd/system ]; then
  install -m 644 "$source_dir"/systemd/life-*.service "$source_dir"/systemd/life-*.timer /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now life-update.timer life-backup.timer
fi

"$LIFE_HOME/bin/life-update"

cat <<DONE

Готово. Приложение: $(sed -n 's/^PUBLIC_URL=//p' "$LIFE_HOME/.env")
Ссылка для первого администратора:
  cd $LIFE_HOME && docker compose exec backend python -m app.cli invite --admin
DONE
