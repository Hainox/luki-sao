FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Непривилегированный nginx (слушает 8080, pid/temp в /tmp) — порт наружу
# не публикуется, к контейнеру ходит только общий TLS-proxy журнала обходов.
FROM nginxinc/nginx-unprivileged:1.30-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
