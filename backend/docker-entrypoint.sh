#!/usr/bin/env sh
set -e

# Bind mount каталога загрузок с хоста перекрывает владельца, заданного в
# образе, — чиним на каждом старте, иначе appuser не сможет сохранить фото.
chown -R appuser:appgroup /app/uploads

# Миграции — на каждом старте: все они идемпотентны (IF NOT EXISTS), а
# ручной шаг «не забыть alembic upgrade head» после обновления в журнале
# обходов уже не раз забывали. БД может ещё подниматься — несколько попыток.
i=0
until alembic upgrade head; do
  i=$((i + 1))
  if [ "$i" -ge 10 ]; then
    echo "alembic upgrade head: не удалось после $i попыток" >&2
    exit 1
  fi
  echo "БД ещё не готова, повтор через 3с ($i/10)..." >&2
  sleep 3
done

# setpriv меняет только uid/gid, HOME остаётся /root — asyncpg при
# подключении проверяет $HOME/.postgresql/… и падает с PermissionError под
# appuser (так уже ломался весь API журнала обходов). HOME — каталог appuser.
export HOME=/app
exec setpriv --reuid=appuser --regid=appgroup --init-groups "$@"
