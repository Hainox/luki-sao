FROM python:3.12-slim@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY data/ ./data/
COPY alembic.ini .
COPY alembic/ ./alembic/
COPY docker-entrypoint.sh .

# Непривилегированный пользователь: контейнер разбирает произвольные
# загружаемые фото (Pillow/libheif), и запуск от root без нужды расширял бы
# последствия уязвимости в декодере. UID не 1000 — чтобы не совпасть
# случайно с реальным пользователем хоста. Сам контейнер стартует от root
# только чтобы починить владельца примонтированного каталога загрузок, и
# сразу переходит на appuser (см. docker-entrypoint.sh).
RUN chmod +x docker-entrypoint.sh \
    && mkdir -p /app/uploads \
    && groupadd -g 10001 appgroup \
    && useradd -u 10001 -g appgroup -M -s /usr/sbin/nologin appuser \
    && chown -R appuser:appgroup /app

ENV UPLOAD_DIR=/app/uploads
EXPOSE 8000
ENTRYPOINT ["./docker-entrypoint.sh"]
# CMD, а не часть entrypoint: `docker compose run --rm luki-api <команда>`
# должен выполнять именно переданную команду.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips \"${FORWARDED_ALLOW_IPS:-127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16}\""]
