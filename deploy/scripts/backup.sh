#!/usr/bin/env bash
# Ночной бэкап «Люков САО»: дамп БД + архив фотографий. Вызывается из cron,
# см. deploy/README.md. Ротация — как в журнале обходов.
set -euo pipefail
cd "$(dirname "$0")/../.."

# Пароль БД libpq берёт из PGPASSWORD, а не из POSTGRES_PASSWORD контейнера —
# без него pg_dump молча падал с «password authentication failed», и ночной
# cron писал пустые дампы. Пароль читаем из .env рядом с compose-файлом.
if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi
if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "$(date -Is) backup.sh: нет POSTGRES_PASSWORD в окружении/.env — бэкап невозможен." >&2
  exit 1
fi
export PGPASSWORD="$POSTGRES_PASSWORD"

STAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$(pwd)/backups"
UPLOADS_DIR="data/uploads"
mkdir -p "$BACKUP_DIR"

DB_DUMP="$BACKUP_DIR/db_${STAMP}.sql.gz"
docker compose -f docker-compose.prod.yml exec -T luki-db \
  pg_dump -U postgres luki_sao | gzip > "$DB_DUMP"

# Пустой дамп (упавший pg_dump) ротация бы не заметила — проверяем сразу.
if [ ! -s "$DB_DUMP" ] || [ "$(stat -c%s "$DB_DUMP")" -lt 1024 ]; then
  echo "$(date -Is) backup.sh: дамп $DB_DUMP пустой или меньше 1 КБ — pg_dump упал, см. вывод выше." >&2
  rm -f "$DB_DUMP"
  exit 1
fi

# Архив фото лежит на том же диске, что и сами фото: если места впритык,
# tar может забить диск до нуля и уронить Postgres (так уже было у журнала
# обходов). Нужно свободного места с запасом в полтора размера фото —
# иначе снимаем только дамп БД и громко пишем об этом в лог.
UPLOADS_SIZE_KB=$(du -sk "$UPLOADS_DIR" | cut -f1)
AVAIL_KB=$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')
NEEDED_KB=$((UPLOADS_SIZE_KB * 3 / 2))

UPLOADS_ARCHIVE="$BACKUP_DIR/uploads_${STAMP}.tar.gz"
UPLOADS_ARCHIVED=""
if [ "$AVAIL_KB" -lt "$NEEDED_KB" ]; then
  echo "$(date -Is) backup.sh: ПРОПУЩЕН архив фото — свободно $((AVAIL_KB / 1024)) МБ, нужно ~$((NEEDED_KB / 1024)) МБ. Снят только дамп БД." >&2
else
  # tar возвращает 1, если файл поменялся во время чтения, — для живого
  # каталога фото это штатно, архив рабочий. Код 2 и выше — настоящая ошибка.
  set +e
  tar -czf "$UPLOADS_ARCHIVE" -C data uploads
  tar_rc=$?
  set -e
  if [ "$tar_rc" -gt 1 ]; then
    echo "$(date -Is) backup.sh: tar завершился с кодом $tar_rc — архив фото мог получиться битым." >&2
    exit "$tar_rc"
  fi
  UPLOADS_ARCHIVED="$UPLOADS_ARCHIVE"
fi

# Дампы БД маленькие — храним 14 дней. Архив фото дублирует каталог 1:1 и
# растёт вместе с ним: держим только последний ночной (старше 20 часов
# удаляем). Для настоящего хранения вне сервера копируйте db_*/uploads_*
# наружу (rclone/rsync), а не увеличивайте срок здесь.
find "$BACKUP_DIR" -name 'db_*.sql.gz' -type f -mtime +14 -delete
find "$BACKUP_DIR" -name 'uploads_*.tar.gz' -type f -mmin +1200 -delete

# Оффсайт: если задан BACKUP_RSYNC_DEST (user@host:/path или локальный путь),
# заливаем свежие архивы наружу сразу после снятия. Без него — только
# предупреждение: бэкап на том же диске сервер не переживёт.
if [ -n "${BACKUP_RSYNC_DEST:-}" ]; then
  # shellcheck disable=SC2086
  rsync -a --timeout=300 "$DB_DUMP" ${UPLOADS_ARCHIVED:+$UPLOADS_ARCHIVED} \
    "$BACKUP_RSYNC_DEST/" 2>/dev/null || \
    echo "$(date -Is) backup.sh: ПРЕДУПРЕЖДЕНИЕ — rsync в $BACKUP_RSYNC_DEST не удался, копии только локальные." >&2
else
  echo "$(date -Is) backup.sh: ПРЕДУПРЕЖДЕНИЕ — BACKUP_RSYNC_DEST не задан, копии только на этом диске." >&2
fi

# Шифрование дампа БД (опционально): с BACKUP_GPG_RECIPIENT дамп шифруется
# на указанный ключ, открытый текст удаляется. Без gpg/ключа — пропускаем.
if [ -n "${BACKUP_GPG_RECIPIENT:-}" ] && command -v gpg >/dev/null 2>&1; then
  if gpg --batch --yes --trust-model always -r "$BACKUP_GPG_RECIPIENT" \
      --encrypt --output "$DB_DUMP.gpg" "$DB_DUMP" 2>/dev/null; then
    rm -f "$DB_DUMP"
    echo "$(date -Is) backup.sh: OK (зашифровано: $DB_DUMP.gpg)"
  else
    echo "$(date -Is) backup.sh: ПРЕДУПРЕЖДЕНИЕ — gpg-шифрование не удалось, оставляю открытый $DB_DUMP." >&2
    echo "$(date -Is) backup.sh: OK ($DB_DUMP)"
  fi
else
  echo "$(date -Is) backup.sh: OK ($DB_DUMP)"
fi

# Сторожок свежести для мониторинга: алерт, если предыдущий успешный бэкап
# старше 26 часов (бэкап должен быть ночным и ежедневным).
if [ -f "$BACKUP_DIR/.last_backup_ok" ] && \
    find "$BACKUP_DIR" -maxdepth 1 -name '.last_backup_ok' -mmin +1560 -print 2>/dev/null | grep -q .; then
  echo "$(date -Is) backup.sh: ПРЕДУПРЕЖДЕНИЕ — предыдущий успешный бэкап старше 26 часов." >&2
fi
touch "$BACKUP_DIR/.last_backup_ok"
