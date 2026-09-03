# syntax=docker/dockerfile:1.7
# ────────────────────────────────────────────────────────────
# Stage 1 — deps
# ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps

# ────────────────────────────────────────────────────────────
# Stage 2 — build
# Produces .next/standalone (server) + .next/static (assets).
# BUILD_STANDALONE=true is required to enable Next's standalone
# output mode (see next.config.mjs).
# ────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat
ENV NEXT_TELEMETRY_DISABLED=1
ENV BUILD_STANDALONE=true

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ────────────────────────────────────────────────────────────
# Stage 3 — runtime
# Copies the standalone server, the static assets, and the
# public/ folder. Total image size: ~150MB.
# ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache libc6-compat tini
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Standalone output contains a minimal node_modules in .next/standalone
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets must be copied separately (standalone excludes them)
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
