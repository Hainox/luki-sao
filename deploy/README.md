# Деплой «Люки САО»

Приложение стоит на том же сервере, что и журнал обходов (JiraJura,
`/opt/jirajura`), но отдельным compose-проектом в `/opt/luki-sao` со своей
БД, фото и бэкапами. Наружу оно не публикует ни одного порта:

```
браузер ──443──> proxy журнала обходов ──> luki-web:8080 ──> luki-api:8000 ──> luki-db
                  (сертификат luki.obhod-sao.ru)                  │
                                                                  └──> api:8000 журнала обходов (вход)
```

- `luki-web` и `luki-api` входят во внешнюю сеть `jirajura_default` (её
  создаёт compose-проект журнала обходов) под этими именами — так до них
  достаёт proxy журнала обходов, а `luki-api` проверяет логины через
  `http://api:8000`. БД в эту сеть не входит.
- Все сервисы называются с префиксом `luki-` (`luki-db`, `luki-api`,
  `luki-web`): имя сервиса становится DNS-именем во всех его сетях. Второй
  `api` в `jirajura_default` перехватывал бы запросы к журналу обходов, а
  `luki-api` по имени `db` попадал бы в базу журнала обходов (так и было при
  первом запуске 01.10.2026 — api падал на `password authentication failed`).

Отсюда два правила:
- журнал обходов должен быть запущен раньше — без сети `jirajura_default`
  `up -d` здесь падает с «network jirajura_default declared as external,
  but could not be found»;
- не делайте `docker compose down` в `/opt/jirajura`, пока работают «Люки
  САО»: `down` пытается удалить сеть. Для обновления журнала обходов
  хватает его обычного деплоя (`up -d`), сеть он не пересоздаёт.

## 1. Подключение к proxy журнала обходов (один раз)

Делается на стороне журнала обходов (его `deploy/README.md`, раздел «Люки
САО»). Нужны DNS-запись `luki.obhod-sao.ru` → IP сервера и задеплоенный
журнал обходов с server-блоком `deploy/nginx/sites/luki-sao.conf`:

```bash
cd /opt/jirajura
./deploy/scripts/enable-luki-sao.sh
```
Скрипт выпускает сертификат для `luki.obhod-sao.ru` и включает сайт. До
запуска самого приложения (п. 2) сайт отвечает `502` — это нормально.
Продлевается сертификат вместе с основным (`renew-cert*.sh` журнала
обходов).

## 2. Первая установка

```bash
cd /opt
git clone https://github.com/Hainox/luki-sao.git
cd luki-sao
cp .env.example .env
sed -i "s/^SECRET_KEY=.*/SECRET_KEY=$(openssl rand -hex 32)/" .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 16)/" .env

docker network inspect jirajura_default >/dev/null && echo "сеть журнала обходов есть"
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```
`.env` в git не попадает; `SECRET_KEY` и пароль БД после первого запуска не
меняйте (смена ключа разлогинит всех, смена пароля — отрежет api от уже
созданной БД). С ключом-заготовкой из `.env.example` API в проде не стартует
намеренно.

Миграции БД применяет сам `luki-api` при каждом старте
(`backend/docker-entrypoint.sh`), отдельно запускать `alembic` не нужно.

Проверка:
```bash
# API живо
docker compose -f docker-compose.prod.yml exec luki-api \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/api/health').read())"
# api «Люков» видит журнал обходов (иначе вход не заработает)
docker compose -f docker-compose.prod.yml exec luki-api \
  python -c "import urllib.request; print(urllib.request.urlopen('http://api:8000/api/v1/health').status)"
# снаружи
curl -I https://luki.obhod-sao.ru/
```
Дальше — войти на https://luki.obhod-sao.ru логином журнала обходов:
сотрудником района и администратором.

## 3. Обновление

```bash
cd /opt/luki-sao
git status --short          # должно быть пусто: правки на сервере — только через git
git pull --ff-only
docker compose -f docker-compose.prod.yml up -d --build
```
Фото (`data/uploads`) и БД (том `pgdata`) при пересборке не трогаются.
Справочник ДТ/ОДХ API загружает сам при старте, если файл в репозитории
поменялся: в логе `docker compose -f docker-compose.prod.yml logs luki-api`
строка «Справочник ДТ/ОДХ загружен…» или «…не менялся».

## 4. Бэкапы

`deploy/scripts/backup.sh` — дамп БД и архив фото в `/opt/luki-sao/backups`.
Дампы хранятся 14 дней, архив фото — только последний (он дублирует каталог
1:1); для хранения вне сервера копируйте их наружу. Если места на диске
мало, архив фото пропускается с сообщением в логе — дамп БД снимается всегда.

Ночной запуск (через полчаса после бэкапа журнала обходов в 02:00):
```bash
(crontab -l 2>/dev/null; echo "30 2 * * * /opt/luki-sao/deploy/scripts/backup.sh >> /var/log/luki-sao-backup.log 2>&1") | crontab -
```

Восстановление (на пустую БД после первой установки):
```bash
cd /opt/luki-sao
gunzip -c backups/db_ГГГГММДД_ччммсс.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T luki-db psql -U postgres luki_sao
tar -xzf backups/uploads_ГГГГММДД_ччммсс.tar.gz -C data
```

## 5. Если что-то не так

| Симптом | Причина и что делать |
|---|---|
| `502` на https://luki.obhod-sao.ru | `luki-web` не запущен или не в сети `jirajura_default`: `docker compose -f docker-compose.prod.yml ps`, затем `up -d` |
| Сайт не открывается, ошибка сертификата | сайт не включён в proxy журнала обходов — п. 1 |
| «Журнал обходов сейчас недоступен» при входе | `luki-api` не достаёт `http://api:8000` — вторая проверка из п. 2; журнал обходов запущен? |
| «Слишком много попыток входа» | ограничение журнала обходов по IP; подождать, как и там |
| «Сначала смените пароль в журнале обходов…» | у пользователя временный пароль — войти на obhod-sao.ru, сменить, вернуться |
| Не загружается фото | больше 20 МБ или не jpg/png/heic/webp; логи: `docker compose -f docker-compose.prod.yml logs --tail 100 luki-api` |
