#!/usr/bin/env bash
# Выполняется внутри «сервера» (см. run.sh): ставит приложение скриптами из deploy/ и
# проверяет, что бэкап, обновление и восстановление работают.
set -euo pipefail

APP="http://host.docker.internal:8080"
BACKUPS=/opt/life/backups

step() { echo "== $*"; }
fail() {
  echo "ПРОВАЛ: $*" >&2
  exit 1
}
backups() { find "$BACKUPS" -name "life-*-$1.sql.gz.age" | wc -l; }
image_of() { docker inspect --format '{{.Image}}' "$(cd /opt/life && docker compose ps --quiet "$1")"; }
users_in() { "$@" psql --username life --dbname life --tuples-only --no-align --command 'SELECT count(*) FROM users'; }

step "юниты systemd составлены верно"
systemd-analyze verify /src/deploy/systemd/life-*.service /src/deploy/systemd/life-*.timer 2>&1 \
  | grep -v "is not executable" || true
for unit in /src/deploy/systemd/life-*.service /src/deploy/systemd/life-*.timer; do
  systemd-analyze verify "$unit" 2>&1 | grep -iE "unknown|invalid|failed to parse" && fail "ошибка в $unit"
done

step "без открытого ключа и домена установка отказывается"
bash /src/deploy/install.sh 2>/dev/null && fail "установка без аргументов прошла"
bash /src/deploy/install.sh life.example.com not-a-key 2>/dev/null && fail "принят неверный ключ"
[ ! -e /opt/life/.env ] || fail "отказавшаяся установка оставила .env"

step "первая установка"
age-keygen --output /root/backup.key 2>/dev/null
recipient="$(age-keygen -y /root/backup.key)"
# «:80» вместо домена — простой HTTP: получать сертификат в проверке не у кого.
HTTP_PORT=8080 HTTPS_PORT=8443 \
  BACKEND_IMAGE="$REGISTRY/life-backend" WEB_IMAGE="$REGISTRY/life-web" \
  bash /src/deploy/install.sh :80 "$recipient" >/dev/null
[ "$(stat --format %a /opt/life/.env)" = 600 ] || fail ".env доступен не только владельцу"
[ "$(stat --format %a "$BACKUPS")" = 700 ] || fail "каталог бэкапов доступен не только владельцу"
curl --fail --silent "$APP/api/health" | grep -q '"status":"ok"' || fail "приложение не отвечает"
[ "$(backups pre-update)" = 0 ] || fail "бэкап пустой базы при первой установке не нужен"

step "регистрация пользователя через приложение"
cd /opt/life
token="$(docker compose exec -T backend python -m app.cli invite --admin | sed 's/.*#//')"
curl --fail --silent --output /dev/null "$APP/api/auth/register" \
  --header 'Content-Type: application/json' \
  --data "{\"token\":\"$token\",\"email\":\"deploy@example.com\",\"password\":\"correct horse battery\",\"display_name\":\"Deploy\",\"language\":\"ru\",\"timezone\":\"Europe/Moscow\",\"accept_disclaimer\":true}" \
  || fail "регистрация не прошла"
[ "$(users_in docker compose exec -T db)" = 1 ] || fail "пользователь не появился в базе"

step "автообновления нет: в установке нет таймера, который запускал бы life-update"
[ -z "$(find /src/deploy/systemd -name '*update*')" ] || fail "в deploy/systemd остался юнит обновления"
grep -rqE 'enable[^|]*life-update' /src/deploy/install.sh && fail "установщик включает таймер обновления"

step "повторный запуск без новых образов ничего не трогает и говорит об этом"
before="$(image_of backend)"
started="$(docker inspect --format '{{.State.StartedAt}}' "$(docker compose ps --quiet backend)")"
/opt/life/bin/life-update | grep -q 'обновлять нечего' || fail "life-update не сообщил, что обновлять нечего"
[ "$(image_of backend)" = "$before" ] || fail "образ сменился без причины"
[ "$(docker inspect --format '{{.State.StartedAt}}' "$(docker compose ps --quiet backend)")" = "$started" ] \
  || fail "контейнер перезапущен без причины"
[ "$(backups pre-update)" = 0 ] || fail "сделан лишний бэкап"

step "ручной бэкап зашифрован"
backup="$(/opt/life/bin/life-backup manual)"
[ -s "$backup" ] || fail "файл бэкапа пуст"
[ "$(stat --format %a "$backup")" = 600 ] || fail "бэкап доступен не только владельцу"
head --bytes 21 "$backup" | grep -q 'age-encryption.org' || fail "бэкап не зашифрован age"
gunzip --test "$backup" 2>/dev/null && fail "бэкап читается без ключа"

step "без открытого ключа бэкап не делается"
sed -i 's/^BACKUP_RECIPIENT=.*/BACKUP_RECIPIENT=/' .env
/opt/life/bin/life-backup manual 2>/dev/null && fail "сделан нешифрованный бэкап"
sed -i "s/^BACKUP_RECIPIENT=.*/BACKUP_RECIPIENT=$recipient/" .env

step "новый образ в реестре: бэкап, затем обновление, данные на месте — даже при двух запусках разом"
docker tag "$REGISTRY/life-backend:next" "$REGISTRY/life-backend:latest"
docker push --quiet "$REGISTRY/life-backend:latest" >/dev/null
# Два запуска разом — например, из двух сеансов: работает один, второй ждёт.
/opt/life/bin/life-update &
first=$!
/opt/life/bin/life-update &
second=$!
wait "$first" || fail "первый из одновременных запусков завершился ошибкой"
wait "$second" || fail "второй из одновременных запусков завершился ошибкой"
[ "$(image_of backend)" != "$before" ] || fail "контейнер остался на старом образе"
[ "$(backups pre-update)" = 1 ] || fail "перед обновлением должен быть ровно один бэкап"
curl --fail --silent "$APP/api/health" | grep -q '"status":"ok"' || fail "после обновления приложение не отвечает"
[ "$(users_in docker compose exec -T db)" = 1 ] || fail "данные потеряны при обновлении"

step "повторная установка обновляет файлы и сохраняет секреты"
secrets="$(grep -E '^(JWT_SECRET|POSTGRES_PASSWORD)=' .env)"
bash /src/deploy/install.sh >/dev/null
[ "$(grep -E '^(JWT_SECRET|POSTGRES_PASSWORD)=' .env)" = "$secrets" ] || fail "секреты перезаписаны"

step "восстановление из бэкапа в чистую базу"
latest="$(find "$BACKUPS" -name 'life-*.sql.gz.age' | sort | tail -n 1)"
docker run --detach --name life-deploy-restore \
  --env POSTGRES_USER=life --env POSTGRES_PASSWORD=restore --env POSTGRES_DB=life postgres:18 >/dev/null
for _ in $(seq 30); do
  docker exec life-deploy-restore pg_isready --username life --dbname life >/dev/null 2>&1 && break
  sleep 1
done
age --decrypt --identity /root/backup.key "$latest" | gunzip \
  | docker exec -i life-deploy-restore psql --username life --dbname life --quiet --set ON_ERROR_STOP=1 >/dev/null
[ "$(users_in docker exec life-deploy-restore)" = 1 ] || fail "в восстановленной базе нет пользователя"
restored_email="$(docker exec life-deploy-restore psql --username life --dbname life --tuples-only --no-align --command 'SELECT email FROM users')"
[ "$restored_email" = "deploy@example.com" ] || fail "восстановлены не те данные"

echo "== выкладка проверена"
