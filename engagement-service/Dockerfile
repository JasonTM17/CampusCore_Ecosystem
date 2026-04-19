FROM node:20-slim AS build

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY packages/platform-auth /packages/platform-auth
RUN cd /packages/platform-auth && npm ci

COPY engagement-service/package*.json ./
RUN npm ci

COPY engagement-service/ ./
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

COPY packages/platform-auth /packages/platform-auth
RUN cd /packages/platform-auth && npm ci --omit=dev

COPY engagement-service/package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/prisma ./prisma

RUN rm -rf /usr/local/lib/node_modules/npm && \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

RUN chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 4004

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD sh -lc 'wget --no-verbose --tries=1 --header="X-Health-Key: ${HEALTH_READINESS_KEY}" -O- http://localhost:4004/api/v1/health/readiness >/dev/null || exit 1'

CMD ["node", "dist/src/main.js"]
