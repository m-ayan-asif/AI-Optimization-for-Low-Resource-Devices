# SkinSense Express API. Build via deploy/docker-compose.yml, or: docker build -t skinsense-api server/
FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=5000 \
    UPLOAD_DIR=/data/uploads

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY src/ ./src/

RUN mkdir -p /data/uploads && chown -R node:node /data
USER node

EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://localhost:5000/api/health >/dev/null || exit 1

CMD ["node", "server.js"]
