# SkinSense web client (PWA): Vite build served by Caddy, which also terminates HTTPS and proxies the APIs.
# The Caddyfile is mounted from deploy/Caddyfile by deploy/docker-compose.yml.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
EXPOSE 80 443 443/udp
