# --- Build stage ---
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Install OpenSSL (required by Prisma)
RUN apk add --no-cache openssl

# Copy dependency manifests first for layer caching
COPY package.json bun.lockb ./

# Deterministic install (fails if lockfile is out of sync)
RUN bun install --frozen-lockfile

# Copy Prisma schema and config before generate
COPY prisma ./prisma

# Generate Prisma client
RUN bunx prisma generate --config prisma/prisma.config.ts

# Copy application source
COPY . .

# --- Runtime stage ---
FROM oven/bun:1-alpine

WORKDIR /app

ENV NODE_ENV=production

# Install OpenSSL (Prisma runtime dependency)
RUN apk add --no-cache openssl

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Copy node_modules with generated Prisma client from builder
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules

# Copy dependency manifest (needed at runtime for Bun module resolution)
COPY --from=builder --chown=appuser:appgroup /app/package.json ./package.json

# Copy Prisma schema (needed at runtime by Prisma client)
COPY --from=builder --chown=appuser:appgroup /app/prisma ./prisma

# Copy application source
COPY --from=builder --chown=appuser:appgroup /app/index.ts ./index.ts
COPY --from=builder --chown=appuser:appgroup /app/dotenv.ts ./dotenv.ts
COPY --from=builder --chown=appuser:appgroup /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=appuser:appgroup /app/src ./src

USER appuser

EXPOSE 3700

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3700/health/status || exit 1

CMD ["bun", "run", "index.ts"]
