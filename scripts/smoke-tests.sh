#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────
# Smoke tests run after a successful deploy.
# Verifies that the staging stack responds correctly.
#
# Exits 0 on success, 1 on any failure. The CD job will mark
# the deploy as failed if any smoke test fails.
# ────────────────────────────────────────────────────────────
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost}"
FAIL=0

echo "▶ Running smoke tests against ${BASE_URL}"

check() {
  local label="$1"; shift
  local url="$1"; shift
  local expected="$1"; shift

  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" -L --max-time 10 "$url" || echo "000")
  if [ "$code" = "$expected" ]; then
    echo "  ✓ ${label} (${code})"
  else
    echo "  ✗ ${label} — got ${code}, expected ${expected}"
    FAIL=1
  fi
}

# 1. Nginx serves the frontend root (Next.js landing page)
check "Frontend root"        "${BASE_URL}/"             200

# 2. Frontend serves the login page
check "Login page"           "${BASE_URL}/login"        200

# 3. Backend health endpoint is reachable via the /api proxy
check "Backend health"       "${BASE_URL}/api/health"   200

# 4. Backend readiness (DB + Redis + storage)
check "Backend readiness"    "${BASE_URL}/api/health/ready" 200

# 5. Swagger UI is up
check "Swagger UI"           "${BASE_URL}/docs"         200

# 6. /api/auth/login with bad creds returns 401 (not 500)
code=$(curl -s -o /dev/null -w "%{http_code}" -L --max-time 10 \
  -X POST -H "Content-Type: application/json" \
  -d '{"email":"[email protected]","password":"wrong"}' \
  "${BASE_URL}/api/auth/login" || echo "000")
if [ "$code" = "401" ] || [ "$code" = "400" ]; then
  echo "  ✓ Login rejects bad creds (${code})"
else
  echo "  ✗ Login bad-creds returned ${code}, expected 401/400"
  FAIL=1
fi

# 7. /api/v1/* not exposed (the API is mounted under /api, not /api/v1)
check "Versioned path 404"   "${BASE_URL}/api/v1/agents" 404

if [ $FAIL -eq 0 ]; then
  echo "✓ All smoke tests passed"
  exit 0
else
  echo "✗ Some smoke tests failed"
  exit 1
fi
