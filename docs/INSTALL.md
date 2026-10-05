# Установка на сервер

Как поставить приложение на свой сервер, как оно обновляется и как устроены бэкапы.
Почему выкладка устроена именно так — в [ADR 0005](adr/0005-deployment.md); что делать,
если что-то пошло не так, — в [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Что окажется на сервере

| Где | Что |
|-----|-----|
| `/opt/life/compose.yaml` | описание контейнеров |
| `/opt/life/.env` | настройки и секреты; доступен только root |
| `/opt/life/bin/` | `life-update` и `life-backup` |
| `/opt/life/backups/` | шифрованные дампы базы; доступен только root |
| `/opt/life/src/` | клон репозитория — из него ставятся файлы выше |
| `/etc/systemd/system/life-*` | таймеры обновления и бэкапа |
| тома Docker `life_db`, `life_caddy_data`, `life_caddy_config` | база и сертификаты |

Работают три контейнера: PostgreSQL, бэкенд и Caddy. В покое они занимают около 130 МБ
памяти; образы — около 800 МБ диска.

## Что нужно

- Ubuntu 24.04, доступ root.
- Домен с A-записью на адрес сервера.
- Свободные и открытые снаружи порты **TCP 80 и 443**. UDP-порты приложение не занимает.
- Не меньше 512 МБ свободной памяти и 3 ГБ диска. На сервере с 1 ГБ памяти полезен файл
  подкачки.

## Если на сервере есть VPN или другая маршрутизация

Сам установщик не трогает ни файрвол, ни маршрутизацию, ни настройки Docker. Задеть VPN
может установка Docker — её вы делаете сами, поэтому сначала прочтите этот раздел.

1. **Правило пересылки.** При старте Docker может переключить политику цепочки `FORWARD`
   в `DROP`, и сервер перестанет пересылать пакеты VPN-клиентов. Чтобы этого не случилось,
   **до установки Docker** создайте `/etc/docker/daemon.json`:

   ```json
   { "ip-forward-no-drop": true }
   ```

2. **Подсети.** Docker берёт сети из `172.17.0.0/16` и соседних. Если VPN использует
   адреса из `172.16.0.0/12`, добавьте в тот же файл свой диапазон, например:

   ```json
   {
     "ip-forward-no-drop": true,
     "default-address-pools": [{ "base": "10.210.0.0/16", "size": 24 }]
   }
   ```

3. **Docker уже установлен.** Параметр `ip-forward-no-drop` понимает Docker 28 и новее
   (`docker --version`); более старый с незнакомым параметром не запустится. Изменение
   `daemon.json` вступает в силу после `systemctl restart docker`, а перезапуск
   останавливает все контейнеры: если VPN сам работает в контейнере, он на это время
   отключится.

4. **Проверка.** После установки Docker и после установки приложения подключитесь к VPN с
   клиента и убедитесь, что интернет через него работает.

## Шаг 1. Ключ для бэкапов — на своём компьютере

Бэкапы шифруются открытым ключом, а читаются только закрытым. Закрытый ключ на сервер не
попадает.

```bash
brew install age
```

```bash
age-keygen -o life-backup.key
```

Команда напечатает открытый ключ (`age1…`) — он понадобится на шаге 3. Файл
`life-backup.key` сохраните в менеджере паролей: **без него бэкапы не прочитать.**

## Шаг 2. Подготовка сервера

Всё нужное есть в репозитории Ubuntu. Если на сервере работает VPN — сначала раздел выше:
`daemon.json` должен появиться до установки Docker.

```bash
sudo apt-get update
```

```bash
sudo apt-get install -y docker.io docker-compose-v2 age git
```

Если включён `ufw`, откройте порты:

```bash
sudo ufw allow 80,443/tcp
```

## Шаг 3. Установка

```bash
sudo git clone https://github.com/BorisToboltsov/project_life /opt/life/src
```

```bash
sudo bash /opt/life/src/deploy/install.sh life.example.com age1…
```

Первый аргумент — домен, второй — открытый ключ из шага 1. Установщик создаст `.env` с
секретами (они генерируются на сервере и никуда не передаются), скачает образы, запустит
контейнеры и включит таймеры. Сертификат Caddy получит сам при первом обращении к домену.

## Шаг 4. Первый администратор

```bash
cd /opt/life && sudo docker compose exec backend python -m app.cli invite --admin
```

Команда печатает ссылку; откройте её и зарегистрируйтесь. Остальных приглашаете уже из
приложения — см. [GUIDE.md](GUIDE.md).

## Обновление

**Само.** Каждые 5 минут таймер `life-update.timer` проверяет реестр. Если после коммита
в `main` и зелёного CI там появились новые образы, скрипт делает бэкап базы и
перезапускает контейнеры. Так меняются только образы приложения.

| Что | Команда |
|-----|---------|
| Обновить сейчас | `sudo /opt/life/bin/life-update` |
| Журнал обновлений | `journalctl -u life-update` |
| Остановить автообновление | `sudo systemctl disable --now life-update.timer` |
| Какая версия работает | `curl -s https://life.example.com/api/health` |

**Файлы сервера** — `compose.yaml`, скрипты, таймеры — обновляются только вручную:

```bash
sudo git -C /opt/life/src pull
```

```bash
sudo bash /opt/life/src/deploy/install.sh
```

Секреты в `.env` повторная установка не трогает.

**Откат.** В `/opt/life/.env` замените `IMAGE_TAG=latest` на тег прежней сборки вида
`0.2.0-1a4e002` (список — на странице пакета в GitHub) и запустите `life-update`.
Миграции назад не откатываются: если новая версия меняла схему базы, после смены тега
восстановите базу из бэкапа с меткой `pre-update`.

## Бэкапы

Файлы лежат в `/opt/life/backups/` и называются
`life-<дата и время UTC>-<метка>.sql.gz.age`. Метки: `daily` — ежедневный в 03:30,
`pre-update` — перед обновлением, `manual` — сделанный вручную. Хранятся 30 дней.

| Что | Команда |
|-----|---------|
| Сделать бэкап сейчас | `sudo /opt/life/bin/life-backup` |
| Журнал бэкапов | `journalctl -u life-backup` |

**Копия вне сервера.** Пока она не настроена, бэкапы защищают от ошибок приложения, но не
от потери сервера. Поставьте `rclone`, настройте хранилище (`rclone config`) и впишите
путь в `/opt/life/.env`, например `BACKUP_REMOTE=backup:life`. Каждый новый бэкап будет
копироваться туда. Файлы зашифрованы, поэтому подойдёт любое хранилище.

**Восстановление.** Расшифровка идёт на вашем компьютере — там, где закрытый ключ:

```bash
scp root@life.example.com:/opt/life/backups/life-20261005T033000Z-daily.sql.gz.age .
```

```bash
age --decrypt --identity life-backup.key life-20261005T033000Z-daily.sql.gz.age | gunzip > life.sql
```

На сервере на время восстановления остановите приложение, залейте дамп и запустите снова:

```bash
ssh root@life.example.com 'cd /opt/life && docker compose stop web backend'
```

```bash
ssh root@life.example.com 'cd /opt/life && docker compose exec -T db psql --username life --dbname life --quiet --set ON_ERROR_STOP=1' < life.sql
```

```bash
ssh root@life.example.com 'cd /opt/life && docker compose start backend web'
```

Дамп сам удаляет прежние таблицы, так что база приходит ровно к состоянию бэкапа.

**Проверка раз в квартал.** Бэкап, который ни разу не восстанавливали, — не бэкап.
Залейте свежий дамп в пустую базу на своём компьютере и посмотрите, что данные на месте:

```bash
docker run --detach --name life-restore --env POSTGRES_USER=life --env POSTGRES_PASSWORD=restore --env POSTGRES_DB=life postgres:18
```

```bash
docker exec -i life-restore psql --username life --dbname life --quiet --set ON_ERROR_STOP=1 < life.sql
```

```bash
docker exec life-restore psql --username life --dbname life --command 'SELECT count(*) FROM users'
```

```bash
docker rm --force life-restore
```

## Удаление

```bash
sudo systemctl disable --now life-update.timer life-backup.timer
```

```bash
cd /opt/life && sudo docker compose down
```

Данные остаются в томах Docker. `docker compose down --volumes` удалит и их — вместе с
базой.
