FROM node:22-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Непривилегированный nginx (слушает 8080, pid/temp в /tmp) — порт наружу
# не публикуется, к контейнеру ходит только общий TLS-proxy журнала обходов.
FROM nginxinc/nginx-unprivileged:1.31-alpine@sha256:26b0bf6fbf07297983cb341998d79c831508787de26627dd2a112321b9c3a4af
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Базовый образ и так работает от nginx (UID 101); явный USER — чтобы это
# было видно в самом Dockerfile и проверке trivy (DS-0002).
USER 101
EXPOSE 8080
