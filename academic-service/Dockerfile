FROM node:20-slim AS build

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY academic-service/package*.json ./
RUN npm ci

COPY academic-service/ ./
RUN npx prisma generate
RUN npm run build

FROM node:20-slim AS production

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3 \
    wget \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1001 nodejs && \
    useradd -r -u 1001 -g nodejs nodejs

COPY academic-service/package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/prisma ./prisma

RUN chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 4003

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD sh -lc 'wget --no-verbose --tries=1 --header="X-Health-Key: ${HEALTH_READINESS_KEY}" -O- http://localhost:4003/api/v1/health/readiness >/dev/null || exit 1'

CMD ["node", "dist/src/main.js"]
