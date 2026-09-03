#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────
# Deploy AIBOS staging from a freshly pushed image tag.
#
# This script is copied to /opt/aibos by the CD workflow and run
# on the staging VM. It expects:
#   - /opt/aibos/backend/.env.staging   (chmod 600, populated)
#   - /opt/aibos/docker/                (compose + nginx config)
#   - IMAGE_TAG, BACKEND_IMAGE, FRONTEND_IMAGE env vars set by CD
#
# Steps:
#   1. Login to ghcr.io
#   2. Pull backend + frontend images
#   3. docker compose pull + up -d
#   4. tail logs for 30s to surface obvious errors
#   5. exit 0 on success, exit 1 on failure (CD will mark failed)
# ────────────────────────────────────────────────────────────
set -euo pipefail

: "${IMAGE_TAG:?IMAGE_TAG must be set (e.g. v1.2.3 or a commit sha)}"
: "${BACKEND_IMAGE:?BACKEND_IMAGE must be set}"
: "${FRONTEND_IMAGE:?FRONTEND_IMAGE must be set}"

cd /opt/aibos

echo "▶ Deploying AIBOS staging"
echo "  IMAGE_TAG     = ${IMAGE_TAG}"
echo "  BACKEND_IMAGE = ${BACKEND_IMAGE}"
echo "  FRONTEND_IMAGE= ${FRONTEND_IMAGE}"

# 1. Login (uses a token provisioned on the VM, see runbook)
if [ -f /opt/aibos/.ghcr-token ]; then
  echo "▶ Logging in to ghcr.io"
  echo "$(cat /opt/aibos/.ghcr-token)" | docker login ghcr.io -u $(cat /opt/aibos/.ghcr-user) --password-stdin
fi

# 2. Tag pulled images with the version we want to deploy
#    (compose pulls `latest` by default; we re-tag after pull)
echo "▶ Pulling images"
docker pull "${BACKEND_IMAGE}:${IMAGE_TAG}"
docker pull "${FRONTEND_IMAGE}:${IMAGE_TAG}"
docker tag "${BACKEND_IMAGE}:${IMAGE_TAG}" "${BACKEND_IMAGE}:staging"
docker tag "${FRONTEND_IMAGE}:${IMAGE_TAG}" "${FRONTEND_IMAGE}:staging"

# 3. Apply migrations FIRST (so the schema is ready when the
#    backend boots). Idempotent.
echo "▶ Applying Prisma migrations"
docker compose -f docker/docker-compose.staging.yml \
  --env-file backend/.env.staging \
  run --rm backend \
  npx prisma migrate deploy

# 4. Restart the stack
echo "▶ Restarting services"
docker compose -f docker/docker-compose.staging.yml \
  --env-file backend/.env.staging \
  --profile staging \
  up -d

# 5. Wait for healthchecks (max 90s)
echo "▶ Waiting for healthchecks"
for i in {1..30}; do
  if curl -sf http://localhost/health >/dev/null 2>&1; then
    echo "✓ Staging healthy after ${i} attempts"
    exit 0
  fi
  sleep 3
done

echo "✗ Staging did not become healthy in 90s"
echo "─── Last 50 lines of backend logs ───"
docker compose -f docker/docker-compose.staging.yml logs --tail=50 backend
exit 1
