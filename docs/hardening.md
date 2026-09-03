# Hardening & QA — Phase 10

## What ships in this phase

| Area | Change | File |
|------|--------|------|
| **SSRF** | `http_request` tool now refuses localhost, private IPs, link-local, CGNAT, cloud metadata, and respects `HTTP_ALLOWED_HOSTS` allowlist (with `*.example.com` wildcards). HTTP is blocked in production. Adds a 15s `AbortSignal.timeout` on every call. | `src/common/security/ssrf.ts`, `src/modules/tools/tools.service.ts` |
| **Rate limiting** | Custom `UserThrottlerGuard` keys on `userId+orgId` instead of IP, so a single user can't bypass by switching org or moving networks. Throttle responses use the standard `{ success: false, error: { code: 'RATE_LIMITED' } }` envelope. | `src/common/guards/user-throttler.guard.ts` |
| **Structured logs** | `pino` + `nestjs-pino` replace Nest's default logger. JSON in production, pretty-printed in dev. Reuses the `x-request-id` from the existing interceptor. Auto-redacts `Authorization`, `Cookie`, and credentials bodies. | `src/logger.module.ts` |
| **Health** | `/health/ready` now also probes S3 and the AI gateway, each with a latency measurement. | `src/health.controller.ts` |
| **Audit viewer** | New `?action=&resourceType=&userId=&since=` filters on `GET /audit-logs`, plus a fast `GET /audit-logs/recent` for the dashboard. | `src/modules/audit/audit.controller.ts` + `audit.service.ts` |
| **Cross-tenant test** | Script extended to assert isolation across **all 22 tenant-scoped tables** (direct + indirect via JOIN). Final tally printed at the end. | `prisma/scripts/cross-tenant-test.ts` |
| **Tests** | 9 SSRF tests + 4 workflow validation tests added. All 25 Phase 6-10 tests green. | `src/common/security/__tests__/ssrf.spec.ts`, `src/modules/workflows/engine/__tests__/workflows.service.spec.ts` |

## SSRF guard

`assertSafeUrl(url)` returns one of:

| code | reason |
|---|---|
| `INVALID_URL` | URL parse failed or length > 2048 |
| `INVALID_URL` | Protocol other than `http(s):` (e.g. `file:`, `gopher:`) |
| `NON_HTTPS` | `http:` and we're in production |
| `PRIVATE_IP` | Host is a private / loopback / link-local / CGNAT / ULA IPv4 or IPv6 |
| `BLOCKED_HOST` | `localhost`, `*.local`, `*.localhost`, `0.0.0.0`, or cloud metadata endpoint |
| `NOT_ALLOWLISTED` | `HTTP_ALLOWED_HOSTS` is set and the host doesn't match |

When the guard rejects, the `http_request` tool returns
`{ ok: false, error: ..., code: 'SSRF_BLOCKED' }` instead of throwing — so
the model can be told the call was refused.

### Configuration

```bash
# .env (production)
HTTP_ALLOWED_HOSTS=api.openai.com,api.anthropic.com,*.googleapis.com
```

## Rate limiting

The Throttler module config (`app.module.ts`) is unchanged at the global
level (`100 req / 60 s`), but every request is now keyed on
`u:{userId}:{orgId}` when authenticated, falling back to `ip:{addr}` for
unauthenticated routes (e.g. `/auth/login`).

To opt-out of per-user throttling on a specific route, use Nest's
`@SkipThrottle()` decorator.

## Health checks

```
GET /health         → { status: 'ok', timestamp }
GET /health/ready   → { status, checks: { postgres, redis, storage, ai } }
```

The readiness check is intentionally cheap (≤ 5s) and times each
dependency. The `autoLogging` config of pino skips both health routes to
avoid flooding logs.

## Audit viewer

```
GET /audit-logs?action=agent&resourceType=agent&since=2026-09-01&limit=200
GET /audit-logs/recent?limit=10
```

`action` uses a `contains` match so you can grep for everything that
starts with `agent.`, `tool.`, etc.

## Cross-tenant script

```bash
cd backend
npm run db:seed -- --with-test-orgs
npm run test:e2e -- cross-tenant
```

Should print `✅ Cross-tenant isolation OK (22 tables)`. Any failure exits
non-zero and blocks CI.

## Tests

```
PASS src/common/security/__tests__/ssrf.spec.ts
PASS src/modules/workflows/engine/__tests__/workflows.service.spec.ts
PASS src/modules/workflows/engine/__tests__/graph.spec.ts
Tests: 25 passed, 25 total
```

## Operational notes

- **Logger**: in production, the JSON output is shipped directly to your
  log aggregator (Datadog, CloudWatch, GCP, etc.). `pino-pretty` is only
  loaded in dev.
- **SECRETS_ENCRYPTION_KEY** is mandatory in production (refused on boot
  by `CredentialsService`).
- **JWT secrets** must be set in production (validated by `validateEnv`).
- **HTTPS termination** is expected to be handled by a reverse proxy
  (Caddy, Nginx, ALB) in front of the NestJS process.

## Known limitations & next steps

- The cross-tenant script still uses raw `pg` — we'd like a Jest-based
  version that runs in CI without spinning up Postgres locally. Defer
  until the integration test harness is built.
- `UserThrottlerGuard` overrides the IP-based key globally; per-route
  overrides (e.g. `/auth/login` can stay IP-based) need to be wired via
  `@Throttle()` decorators on the `AuthController`.
- The audit log retention policy is not enforced by the app — set up a
  periodic job on the DB to delete `audit_logs` older than N days
  depending on your compliance requirements.
- No APM tracing yet (OpenTelemetry). Pino logs include the request id
  and a `service: 'aibos-backend'` tag, which is enough to build
  dashboards, but for distributed tracing across services we'll add
  `@opentelemetry/api` + a Nest interceptor in a later phase.
