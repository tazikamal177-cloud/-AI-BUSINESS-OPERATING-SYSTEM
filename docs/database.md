# AIBOS — Database

> Phase 2 deliverable: PostgreSQL 16 + pgvector, multi-tenant with shared schema and Row-Level Security (RLS).

## 1. Stack

| Component | Choice | Why |
|---|---|---|
| RDBMS | PostgreSQL 16 | JSONB, strong FK, RLS, mature |
| Vector | pgvector (1536 dims) | Co-located with app data, no extra service |
| Cache/Queue | Redis 7 | Sessions, BullMQ, rate limit, short-term memory |
| Object storage | S3-compatible (MinIO dev / S3 prod) | Files, raw uploads |

## 2. Schema overview

All schema is declared in `backend/prisma/schema.prisma` and versioned through Prisma migrations.

Tenant-scoped tables carry an `organization_id uuid not null` and are protected by RLS.
Global tables (`users`, `plans`, global `agents` templates, global `tools` built-ins) have no RLS.

### Models

- **Identity & tenancy**: `users`, `organizations`, `organization_members`, `subscriptions`, `plans`
- **Agent core**: `agents`, `agent_versions`, `agent_tools`, `agent_knowledge`, `tools`, `tool_executions`
- **Knowledge**: `knowledge_bases`, `documents`, `document_chunks` (vector)
- **Operations**: `conversations`, `messages`, `tasks`, `workflows`, `workflow_nodes`, `workflow_edges`, `workflow_runs`, `workflow_run_logs`
- **Integrations**: `integrations`, `integration_credentials`
- **Insights**: `usage_records`, `audit_logs`, `memories`, `notifications`
- **Auth**: `sessions`, `refresh_tokens`

### Versioning

- `agents` are **versioned** through `agent_versions`. The `deployed_version_id` FK on `agents` points to the currently active version. A conversation/run pins a specific `agent_version_id` to guarantee immutability of past executions.
- `workflows` carry a `version int` and a canonical `definition jsonb`; each `workflow_run` snapshots the definition at start.

### Soft-delete

`agents`, `knowledge_bases`, `documents`, `conversations`, `workflows` use a `deleted_at` column. All queries filter `WHERE deleted_at IS NULL` by default.

## 3. Multi-tenant isolation (defense in depth)

Three layers, all required:

### Layer 1 — Prisma middleware (application)
Each request sets the tenant context via AsyncLocalStorage; Prisma queries auto-include `organizationId`.

### Layer 2 — Postgres session GUC
Per request, the connection runs:
```sql
SELECT set_config('app.current_user_id', $1, false);
SELECT set_config('app.current_org_id',  $2, false);
SELECT set_config('app.is_service', 'false', false);  -- true for background jobs
```

### Layer 3 — RLS policies
`backend/prisma/sql/rls.sql` enables RLS on every tenant table and creates policies that:
- compare `organization_id` to `current_setting('app.current_org_id')`
- bypass when `app.is_service = true` (background workers)

Helper functions:
```sql
aibos_current_user_id()  -- uuid
aibos_current_org()      -- uuid
aibos_is_service()       -- boolean
```

The `agents`, `documents`, `conversations`, `integrations`, `workflows`, `usage_records`, `audit_logs`, `memories`, `tasks` tables are protected directly. Related tables (`agent_versions`, `agent_tools`, `messages`, `workflow_*`, `integration_credentials`) are protected via their parent FK.

## 4. Indexes (selected)

| Table | Index | Purpose |
|---|---|---|
| `agents` | `(organization_id, status)`, `(organization_id, deleted_at)` | Tenant filter |
| `agents` | `(organization_id, slug)` UNIQUE | Slug uniqueness per org |
| `document_chunks` | ivfflat on `embedding` (cosine) | ANN search |
| `document_chunks` | `(organization_id)` | RLS + RAG filter |
| `usage_records` | `(organization_id, month_bucket)` | Quota aggregation |
| `conversations` | `(organization_id, agent_id)`, `(organization_id, deleted_at)` | Tenant filter |
| `tasks` | `(organization_id, status)`, `(assigned_to)` | Lists |
| `workflow_runs` | `(workflow_id)`, `(status)` | Engine |

Run `ANALYZE` after bulk inserts (e.g. embeddings) for the planner to pick the ivfflat index.

## 5. Running locally

```bash
# 1. Boot the stack
cd aibos/docker
docker compose up -d

# 2. Apply schema + RLS + seed
cd ../backend
npm install
cp .env.example .env       # adjust if needed
npm run prisma:deploy      # migrations + RLS + vector index
npm run db:seed            # 3 plans, 5 built-in tools, 3 templates, 1 demo org
```

Demo credentials after seed: `[email protected]` / `Demo1234!`

## 6. Cross-tenant test

`backend/prisma/scripts/cross-tenant-test.ts` is the reference for any new tenant table:
1. User A cannot SELECT rows of Org B (0 rows returned, even with raw SQL).
2. User A cannot INSERT a row claiming `organization_id = Org B.id` (Postgres raises `42501`).
3. Vector search returns only chunks of the current org.

This script is run in CI; failure blocks the merge.

## 7. Migrations

- Prisma migrations live in `backend/prisma/migrations/`.
- Two custom SQL scripts (applied after Prisma) live in `backend/prisma/sql/`:
  - `rls.sql` — enables RLS on every tenant table
  - `vector_index.sql` — creates ivfflat ANN indexes
- `npm run prisma:deploy` runs migrations then `apply-rls.ts` which executes both SQL files.

## 8. ERD

See `docs/erd.md` for the Mermaid diagram.

## 9. Backups

For self-hosted: `pg_dump --schema=public` daily. RLS does not impact backup/restore.
For managed Postgres: enable PITR (point-in-time recovery).

## 10. Open follow-ups (post-MVP)

- HNSW index in place of IVFFlat when chunks/org > 100k.
- Partition `usage_records` by month.
- Move audit logs to a separate tablespace after 90 days.
- Add row-level encryption for `integration_credentials.encrypted_value` with KMS-managed keys.
