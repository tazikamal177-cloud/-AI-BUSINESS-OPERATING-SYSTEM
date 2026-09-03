# AIBOS — Backend Foundation (Phase 3)

> NestJS 10 + Prisma 5 + Redis 7, multi-tenant by design.

## Modules

| Module | Path | Rôle |
|---|---|---|
| **PrismaModule** | `src/prisma/prisma.service.ts` | Client Prisma + helpers `withTenant()` / `runWithTenant()` qui posent les GUCs RLS |
| **RedisModule** | `src/redis/` | Client ioredis, cache + BullMQ-ready |
| **TenantModule** | `src/shared/tenant/` | `TenantContext` immutable, `TenantGuard`, `PermissionService`, RBAC (5 rôles fixes) |
| **AuthModule** | `src/modules/auth/` | Register, login, refresh, logout, forgot/reset password, verify email, switch org |
| **OrganizationsModule** | `src/modules/organizations/` | CRUD org, settings, members, invitations, switch role |
| **InvitationsModule** | `src/modules/invitations/` | Invitations par email (token hashé) |
| **MailModule** | `src/modules/mail/` | SMTP via nodemailer (dev: log console) |
| **StorageModule** | `src/modules/storage/` | S3/MinIO via AWS SDK v3 |
| **AuditModule** | `src/modules/audit/` | Logs structurés + `@Audit()` decorator + interceptor |
| **Health** | `src/health.controller.ts` | Liveness + readiness (DB+Redis) |

## Stack

- **NestJS 10** (modules, DI, guards, interceptors, pipes, filters)
- **Prisma 5** + **pgvector**
- **Helmet**, **compression**, **CORS**
- **Swagger** (`/api/docs`)
- **Zod** pour validation env + helper `parseOrThrow`
- **Throttler** global (100 req/min par IP par défaut)

## Multi-tenant : 3 couches

```
┌──────────────────────────────────────────────────────────────────────┐
│  HTTP request                                                        │
│  ────────────                                                        │
│  1. JwtAuthGuard        → vérifie JWT, hydrate req.user              │
│  2. TenantGuard         → lit X-Organization-Id ou JWT, charge       │
│                            OrganizationMember, attache TenantContext  │
│  3. TenantInterceptor   → prisma.runWithTenant() pose les GUCs :     │
│         app.current_user_id  = '<user_id>'                           │
│         app.current_org_id   = '<org_id>'                            │
│         app.is_service       = 'false'                                │
│                            (sur la connexion Prisma)                 │
│  4. RolesGuard / PermissionsGuard  → check role/permission           │
│  5. AuditInterceptor     → écrit audit_logs sur succès               │
│  6. Service              → Prisma queries; RLS applique les filtres  │
│  7. HttpErrorFilter      → enveloppe { success, error }              │
└──────────────────────────────────────────────────────────────────────┘
```

## Routes principales

| Méthode | Route | Auth | Rôle requis |
|---|---|---|---|
| GET | `/api/v1/health` | – | – |
| GET | `/api/v1/health/ready` | – | – |
| POST | `/api/v1/auth/register` | – | – |
| POST | `/api/v1/auth/login` | – | – |
| POST | `/api/v1/auth/refresh` | – | – |
| POST | `/api/v1/auth/logout` | JWT | – |
| POST | `/api/v1/auth/forgot-password` | – | – |
| POST | `/api/v1/auth/reset-password` | – | – |
| POST | `/api/v1/auth/verify-email` | – | – |
| POST | `/api/v1/auth/resend-verification` | JWT | – |
| POST | `/api/v1/auth/change-password` | JWT | – |
| POST | `/api/v1/auth/switch-organization` | JWT | – |
| GET | `/api/v1/auth/me` | JWT | – |
| GET | `/api/v1/organizations` | JWT | – |
| GET | `/api/v1/organizations/:orgId` | JWT + Tenant | member |
| POST | `/api/v1/organizations` | JWT | – |
| PUT | `/api/v1/organizations/:orgId` | JWT + Tenant | OWNER/ADMIN |
| GET | `/api/v1/organizations/:orgId/members` | JWT + Tenant | member |
| POST | `/api/v1/organizations/:orgId/members/invite` | JWT + Tenant | OWNER/ADMIN |
| PUT | `/api/v1/organizations/:orgId/members/:userId` | JWT + Tenant | OWNER |
| DELETE | `/api/v1/organizations/:orgId/members/:userId` | JWT + Tenant | OWNER/ADMIN |
| GET | `/api/v1/organizations/:orgId/invitations` | JWT + Tenant | OWNER/ADMIN |
| POST | `/api/v1/invitations/accept` | – | – |

## RBAC

5 rôles fixes (Phase 3), extensibles via `PermissionService` :

| Rôle | Permissions clés |
|---|---|
| **OWNER** | tout, y compris `member:update-role`, `billing:write`, `audit:read` |
| **ADMIN** | tout sauf `member:update-role` |
| **MANAGER** | agents + KB + workflows (CRUD) |
| **OPERATOR** | lecture agents/KB/workflows + conversation:create |
| **VIEWER** | lecture seule |

## Sécurité

- **Helmet** activé (X-Frame, X-Content-Type, etc.)
- **Compression**
- **CORS** allowlist (production) / permissif (dev)
- **Throttler** global : 100 req/min par IP (configurable)
- **JWT** : access 15m + refresh 7j rotatif, hash bcrypt 12 rounds
- **Tokens éphémères** en Redis : `pwd-reset:*` (1h), `email-verify:*` (24h)
- **Invitations** : `invitations.token_hash` = sha256(token brut)
- **Credentials d'intégration** (Phase 7) : AES-256-GCM, clé dans `ENCRYPTION_KEY`
- **Validation** : `class-validator` global + `ZodValidationPipe` ad hoc
- **Erreurs** : enveloppe `{ success, error: { code, message, details?, requestId? } }`

## Tests

```bash
npm run test            # unit
npm run test:e2e        # e2e (smoke + isolation)
```

Le test e2e (`test/app.e2e-spec.ts`) couvre :
- `/health` + `/health/ready`
- Register, login, me
- Forgot password (anti-enumeration)
- Invitation + accept
- **Cross-tenant denial** (Owner de 2 orgs ne lit pas les membres via la mauvaise org)

## Commandes utiles

```bash
# DB
npm run prisma:generate
npm run prisma:migrate          # dev (génère migration + applique)
npm run prisma:deploy           # prod (migrations + RLS + vector index + invitations)
npm run db:seed                 # plans, tools, templates, demo org
npm run db:reset                # tout reset + reseed

# Run
npm run start:dev               # hot reload
npm run start:prod              # prod
npm run build                   # compile TS
```
