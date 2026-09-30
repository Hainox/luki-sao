#!/usr/bin/env bash
# Ночной бэкап «Люков САО»: дамп БД + архив фотографий. Вызывается из cron,
# см. deploy/README.md. Ротация — как в журнале обходов.
set -euo pipefail
cd "$(dirname "$0")/../.."

STAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$(pwd)/backups"
UPLOADS_DIR="data/uploads"
mkdir -p "$BACKUP_DIR"

docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U postgres luki_sao | gzip > "$BACKUP_DIR/db_${STAMP}.sql.gz"

# Архив фото лежит на том же диске, что и сами фото: если места впритык,
# tar может забить диск до нуля и уронить Postgres (так уже было у журнала
# обходов). Нужно свободного места с запасом в полтора размера фото —
# иначе снимаем только дамп БД и громко пишем об этом в лог.
UPLOADS_SIZE_KB=$(du -sk "$UPLOADS_DIR" | cut -f1)
AVAIL_KB=$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')
NEEDED_KB=$((UPLOADS_SIZE_KB * 3 / 2))

if [ "$AVAIL_KB" -lt "$NEEDED_KB" ]; then
  echo "$(date -Is) backup.sh: ПРОПУЩЕН архив фото — свободно $((AVAIL_KB / 1024)) МБ, нужно ~$((NEEDED_KB / 1024)) МБ. Снят только дамп БД." >&2
else
  # tar возвращает 1, если файл поменялся во время чтения, — для живого
  # каталога фото это штатно, архив рабочий. Код 2 и выше — настоящая ошибка.
  set +e
  tar -czf "$BACKUP_DIR/uploads_${STAMP}.tar.gz" -C data uploads
  tar_rc=$?
  set -e
  if [ "$tar_rc" -gt 1 ]; then
    echo "$(date -Is) backup.sh: tar завершился с кодом $tar_rc — архив фото мог получиться битым." >&2
    exit "$tar_rc"
  fi
fi

# Дампы БД маленькие — храним 14 дней. Архив фото дублирует каталог 1:1 и
# растёт вместе с ним: держим только последний ночной (старше 20 часов
# удаляем). Для настоящего хранения вне сервера копируйте db_*/uploads_*
# наружу (rclone/rsync), а не увеличивайте срок здесь.
find "$BACKUP_DIR" -name 'db_*.sql.gz' -type f -mtime +14 -delete
find "$BACKUP_DIR" -name 'uploads_*.tar.gz' -type f -mmin +1200 -delete

echo "$(date -Is) backup.sh: OK ($BACKUP_DIR/db_${STAMP}.sql.gz)"
