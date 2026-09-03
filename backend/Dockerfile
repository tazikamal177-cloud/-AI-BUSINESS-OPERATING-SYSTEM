# syntax=docker/dockerfile:1.7
# ────────────────────────────────────────────────────────────
# Stage 1 — deps
# Install ALL deps (dev + prod) for the build step. We will prune
# devDependencies in stage 3 to keep the runtime image small.
# ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# libc6-compat for bcrypt, openssl for Prisma engines
RUN apk add --no-cache libc6-compat openssl

# Copy only what's needed for the install to maximise layer cache
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --legacy-peer-deps

# ────────────────────────────────────────────────────────────
# Stage 2 — build
# Compile TypeScript and generate the Prisma client.
# ────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client (required for the runtime import)
RUN npx prisma generate

# Build NestJS → dist/src/main.js
RUN npm run build

# ────────────────────────────────────────────────────────────
# Stage 3 — production deps
# Reinstall only prod dependencies for the runtime image.
# Keeps devDependencies (~200MB) out of the final image.
# ────────────────────────────────────────────────────────────
FROM node:20-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --omit=dev --legacy-peer-deps && npx prisma generate

# ────────────────────────────────────────────────────────────
# Stage 4 — runtime
# Final image: non-root, healthcheck, tini for signal handling.
# ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl tini
ENV NODE_ENV=production \
    PORT=3001

# Create a non-root user and group
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

# Copy production node_modules + Prisma client + compiled output
COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nestjs:nodejs /app/dist ./dist
COPY --from=build --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=build --chown=nestjs:nodejs /app/package.json ./package.json

USER nestjs

EXPOSE 3001

# Healthcheck against the health endpoint.
# The HealthController is mounted with VERSION_NEUTRAL, so its path
# is /api/health (prefix 'api' applied, no version segment). We probe
# that URL. We use /api/health (liveness, cheap) rather than
# /api/health/ready (readiness) — the latter can fail during DB
# migrations at startup and is the orchestrator's job to track.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1

# tini → proper PID 1, signal forwarding, zombie reaping
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/src/main.js"]
