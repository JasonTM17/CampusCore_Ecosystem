# Build stage - using slim for better native module compatibility
FROM node:20-slim AS build

WORKDIR /app

# Install build dependencies for bcrypt (native module)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY packages/platform-auth /packages/platform-auth
RUN cd /packages/platform-auth && npm ci

# Copy package files
COPY auth-service/package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY auth-service/ ./

# Generate Prisma client
RUN npx prisma generate

# Build the application
RUN npm run build

# Production stage
FROM node:20-slim AS production

WORKDIR /app

# Install libssl3 for Prisma on Debian 12 and wget for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3 \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -g 1001 nodejs && \
    useradd -r -u 1001 -g nodejs nodejs

COPY packages/platform-auth /packages/platform-auth
RUN cd /packages/platform-auth && npm ci --omit=dev

# Copy package files
COPY auth-service/package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built application
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/prisma ./prisma

# Drop package manager tooling from the runtime image to reduce attack surface.
RUN rm -rf /usr/local/lib/node_modules/npm && \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# Change ownership
RUN chown -R nodejs:nodejs /app

USER nodejs

# Expose port
EXPOSE 4007

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD sh -lc 'wget --no-verbose --tries=1 --header="X-Health-Key: ${HEALTH_READINESS_KEY}" -O- http://localhost:4007/api/v1/health/readiness >/dev/null || exit 1'

# Start the application
# Published as: <namespace>/campuscore-auth-service:<tag>
CMD ["node", "dist/src/main.js"]
