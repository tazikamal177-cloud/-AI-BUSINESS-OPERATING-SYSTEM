# AIBOS — AI Business Operating System

> Plateforme SaaS multi-tenant pour concevoir, déployer et orchestrer des agents IA qui exécutent de vraies tâches métier.

## État d'avancement

- ✅ **Phase 0** — Discovery & architecture
- ✅ **Phase 1** — Product spec (user stories, RBAC, règles métier)
- ✅ **Phase 2** — Database (Prisma schema, RLS, seed, doc)
- ✅ **Phase 3** — Backend Foundation (auth complet, RBAC, RLS binding, audit, mail, storage, e2e)
- ✅ **Phase 4** — AI Core (3 providers, Agent Runtime, tool calling, HITL, quota, RAG squelette, SSE)
- ✅ **Phase 5** — Agent Builder API (CRUD complet, versionning, deploy/rollback, templates, duplicate, stats, audit)
- ✅ **Phase 6** — Knowledge / RAG (extracteurs PDF/DOCX/CSV/HTML/URL, recursive chunker 800/200, ingestion S3→pgvector, search debug, audit)
- ✅ **Phase 7** — Tools & Integrations (CredentialsService AES-GCM, 3 connecteurs SMTP/Calendar/CRM, 5 nouveaux outils d'intégration, risk policy, HITL)
- ✅ **Phase 8** — Workflow Engine (graph engine + 7 node handlers, validation DAG/cycles, parallel fan-out, edge conditions, snapshots, webhook HMAC)
- ✅ **Phase 9** — Frontend (Next.js 14 App Router, Tailwind, TanStack Query, axios + refresh interceptor, UI primitives, pages : login/register/forgot/dashboard/agents/knowledge/workflows/tasks/conversations/integrations)
- ✅ **Phase 10** — Hardening & QA (SSRF guard, per-user throttling, pino structured logs, health checks S3+AI, audit viewer + filters, cross-tenant script étendu à 22 tables, 25 tests verts)

## Phase 10 — terminée, l'AIBOS MVP est complet. 🎉

Le système est prêt à être déployé en environnement de staging après :
1. `npx prisma migrate dev --name add_workflow_run_org` (Phase 8 schema change)
2. Configuration des variables d'env (voir `.env.example` + `docs/hardening.md`)
3. Lancement des migrations + seed
4. Lancement du test cross-tenant en pré-déploiement

## Quick start

### Prérequis
- Node.js 20+
- Docker & Docker Compose

### 1. Infrastructure

```bash
cd docker
docker compose up -d        # Postgres+pgvector, Redis, MinIO
```

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env        # ajuster OPENAI_API_KEY, JWT secrets, etc.
npm run prisma:deploy       # migrations Prisma + RLS + vector index
npm run db:seed             # plans, tools intégrés, templates, org demo
npm run start:dev
```

Comptes de démo après seed :
- **Owner** : `[email protected]` / `Demo1234!`

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

## Architecture

- **Backend** : NestJS 10 + Prisma 5 + PostgreSQL 16 (RLS) + Redis 7 + BullMQ
- **Frontend** : Next.js 15 (App Router) + Tailwind + shadcn/ui + TanStack Query
- **IA** : Abstraction `AIProvider` (OpenAI, Anthropic, Gemini)
- **Vector** : pgvector (1536 dims, IVFFlat)
- **Stockage** : S3-compatible (MinIO en dev, S3/R2 en prod)
- **Auth** : JWT access + refresh tokens rotatifs
- **Multi-tenant** : schéma partagé + `organization_id` + RLS + interceptor

## Documentation

| Doc | Contenu |
|---|---|
| `docs/architecture.md` | Architecture globale (Phase 0) |
| `docs/database.md` | Schéma, RLS, migrations, multi-tenant |
| `docs/erd.md` | Diagramme entités-relations (Mermaid) |
| `docs/api.md` | Spécification API REST (à venir — Phase 3) |
| `docs/ai-runtime.md` | Agent Runtime (Phase 4) |
| `docs/knowledge.md` | Pipeline RAG (Phase 6) |
| `docs/tools.md` | Tools & Integrations (Phase 7) |
| `docs/workflows.md` | Workflow Engine (Phase 8) |
| `docs/frontend.md` | Frontend Next.js (Phase 9) |
| `docs/hardening.md` | Hardening & QA (Phase 10) |

## Structure du repo

```
aibos/
├── backend/                 # NestJS + Prisma
│   ├── prisma/
│   │   ├── schema.prisma    # Schéma complet
│   │   ├── seed.ts          # Données initiales
│   │   ├── migrations/      # Migrations Prisma
│   │   ├── sql/             # RLS + vector index (post-migration)
│   │   └── scripts/         # Outils (apply-rls, cross-tenant-test)
│   └── src/                 # Code applicatif
├── frontend/                # Next.js (à compléter)
├── docker/                  # docker-compose, init SQL
└── docs/                    # Documentation
```

## Sécurité

- RLS activée sur **toutes** les tables tenant (`organization_id`)
- Le JWT contient l'`activeOrgId` ; un interceptor NestJS injecte le contexte
- Tests cross-tenant en CI bloquant tout merge qui casserait l'isolation
- Clés API IA stockées côté serveur uniquement
- Encryption AES-GCM pour les credentials d'intégration

## Licence

Propriétaire — © AIBOS
