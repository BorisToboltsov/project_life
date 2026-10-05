#!/usr/bin/env bash
# Гейт выкладки (make check-deploy): прогоняет серверные скрипты на Ubuntu 24.04 против
# местного реестра образов — установка, бэкап, обновление, восстановление из бэкапа.
set -euo pipefail
cd "$(dirname "$0")/../.."

REGISTRY="localhost:5055"
# Своё имя проекта: проверка не пересекается ни со стендом e2e, ни с настоящей установкой.
PROJECT="life-deploy-test"

cleanup() {
  docker compose -p "$PROJECT" down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker rm -f life-deploy-registry life-deploy-restore >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

echo "== собираю образы и кладу их в местный реестр"
docker build --quiet -t life-deploy-test deploy/test >/dev/null
docker run --detach --name life-deploy-registry -p 127.0.0.1:5055:5000 registry:2 >/dev/null
for part in backend web; do
  context=$([ "$part" = web ] && echo frontend || echo backend)
  docker build --quiet -t "$REGISTRY/life-$part:latest" "$context" >/dev/null
  docker push --quiet "$REGISTRY/life-$part:latest" >/dev/null
done
# «Следующая версия» бэкенда: тот же код с другой меткой — у образа новый идентификатор.
# Проверка положит её в реестр под тегом latest, когда дойдёт до обновления.
docker build --quiet --label revision=next -t "$REGISTRY/life-backend:next" backend >/dev/null

docker run --rm \
  --volume /var/run/docker.sock:/var/run/docker.sock \
  --volume "$PWD":/src:ro \
  --add-host host.docker.internal:host-gateway \
  --env COMPOSE_PROJECT_NAME="$PROJECT" \
  --env REGISTRY="$REGISTRY" \
  life-deploy-test bash /src/deploy/test/inside.sh
