FROM node:25-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Непривилегированный nginx (слушает 8080, pid/temp в /tmp) — порт наружу
# не публикуется, к контейнеру ходит только общий TLS-proxy журнала обходов.
FROM nginxinc/nginx-unprivileged:1.30-alpine@sha256:ed04ec1ff34502c339ee5c3ae3f855442398edc1d05591e2b98981dcbbd20b1e
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Базовый образ и так работает от nginx (UID 101); явный USER — чтобы это
# было видно в самом Dockerfile и проверке trivy (DS-0002).
USER 101
EXPOSE 8080
