# AIBOS — Agent Builder API (Phase 5)

> CRUD complet agents, versionning, déploiement, templates, et points d'entrée runtime (test + chat SSE).

## Routes principales

### CRUD

| Méthode | Route | Rôle requis | Effet |
|---|---|---|---|
| GET | `/api/v1/agents` | member | Liste paginée (`?status=&search=&cursor=&limit=&includeArchived=`) |
| POST | `/api/v1/agents` | OWNER/ADMIN/MANAGER | Crée un agent (status=DRAFT, v1 auto) |
| GET | `/api/v1/agents/:id` | member | Détail complet (tools, knowledge, versions) |
| PUT | `/api/v1/agents/:id?commit=true&changeNotes=...` | OWNER/ADMIN/MANAGER | Update metadata (commit optionnel → nouvelle version) |
| POST | `/api/v1/agents/:id/duplicate` | OWNER/ADMIN/MANAGER | Clone l'agent (tools + KB inclus) |
| DELETE | `/api/v1/agents/:id` | OWNER/ADMIN | Archive (soft-delete, deletedAt) |
| POST | `/api/v1/agents/:id/restore` | OWNER/ADMIN | Restaure un agent archivé |
| DELETE | `/api/v1/agents/:id/permanent` | OWNER | Hard delete (cascade conversations, tasks, usage…) |
| GET | `/api/v1/agents/:id/stats` | member | Stats 30j (conversations, messages, tokens, cost, pending) |

### Templates

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/v1/agents/templates?category=sales` | member |
| POST | `/api/v1/agents/templates/clone` | OWNER/ADMIN/MANAGER |

Body : `{ "templateSlug": "sales-agent" }` → crée un agent dans l'org.

### Versions

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/v1/agents/:id/versions` | member (top 10) |
| GET | `/api/v1/agents/:id/versions/:versionId` | member |
| POST | `/api/v1/agents/:id/versions` | OWNER/ADMIN/MANAGER |

Body : `{ "changeNotes": "Refonte du prompt" }` → snapshot le state courant en nouvelle version.

### Déploiement

| Méthode | Route | Rôle | Effet |
|---|---|---|---|
| POST | `/api/v1/agents/:id/deploy` | OWNER/ADMIN/MANAGER | Pin une version (status=ACTIVE) |
| POST | `/api/v1/agents/:id/undeploy` | OWNER/ADMIN/MANAGER | Dépin (status=DRAFT) |
| POST | `/api/v1/agents/:id/pause` | OWNER/ADMIN/MANAGER | Status=PAUSED |
| POST | `/api/v1/agents/:id/resume` | OWNER/ADMIN/MANAGER | Status=ACTIVE (réimpose la version pinned) |
| POST | `/api/v1/agents/:id/rollback` | OWNER/ADMIN/MANAGER | Crée une nouvelle version copiant la cible, puis la déploie |

Body `deploy` : `{ "versionId": "uuid" }`
Body `rollback` : `{ "versionId": "uuid" }`

### Tools & Knowledge

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/api/v1/agents/:id/tools` | OWNER/ADMIN/MANAGER |
| DELETE | `/api/v1/agents/:id/tools/:toolId` | OWNER/ADMIN/MANAGER |
| POST | `/api/v1/agents/:id/knowledge` | OWNER/ADMIN/MANAGER |
| DELETE | `/api/v1/agents/:id/knowledge/:kbId` | OWNER/ADMIN/MANAGER |

Body `tools` :
```json
{ "toolId": "uuid", "configuration": {...}, "permissions": {...} }
```

### Runtime

| Méthode | Route | Rôle | Effet |
|---|---|---|---|
| POST | `/api/v1/agents/:id/test` | member | Playground (dry-run) |
| POST | `/api/v1/agents/:id/chat` | member | Production chat (SSE) |

## Versionning & déploiements

L'état d'un agent = une `agent` row + une série de `agent_versions` immuables.

```
agent                 agent_versions
─────────             ──────────────
id                    id
name                  agent_id
... config live ...   version
deployedVersionId ──► config (snapshot immuable)
status                changeNotes
```

- `PUT /:id?commit=false` → mute l'état live, ne crée pas de version (pour itérer vite)
- `PUT /:id?commit=true&changeNotes=…` → mute + snapshot
- `POST /:id/versions` → snapshot du state courant (sans mutation)
- `POST /:id/deploy` → pin une version (status=ACTIVE, deployedVersionId pointe vers elle)
- `POST /:id/rollback` → crée vN+1 qui copie la config de la cible, puis déploie vN+1
- `POST /:id/undeploy` → dépine (status=DRAFT)
- `POST /:id/resume` → ré-active (status=ACTIVE, garde la version pinned)

L'Agent Runtime (Phase 4) lit la version pinned pour les conversations, garantissant l'immutabilité du comportement passé.

## Audit

Toutes les routes mutantes utilisent `@Audit({ action, resourceType })` :
- `agent.create`, `agent.update`, `agent.duplicate`
- `agent.archive`, `agent.restore`, `agent.hard_delete`
- `agent.deploy`, `agent.undeploy`, `agent.rollback`
- `agent.version.create`
- `agent.clone_from_template`

Les entrées sont dans `audit_logs` avec `actor_id`, `organization_id`, `ip`, `user_agent`, `result`.

## Erreurs typiques

| Code | HTTP | Cause |
|---|---|---|
| `AGENT_NOT_FOUND` | 404 | agent_id inexistant ou archivé |
| `AGENT_ALREADY_DEPLOYED` | 409 | deploy sur un agent déjà pinned (info) |
| `AGENT_NOT_DEPLOYED` | 400 | resume() sur un agent non déployé |
| `VERSION_NOT_FOUND` | 404 | version_id inexistant pour cet agent |
| `QUOTA_EXCEEDED` | 400 | quota mensuel atteint (Phase 4) |
| `TOOL_NOT_FOUND` | 404 | tool_id inexistant |

## Tests

```bash
npm run test -- agents.spec.ts
```

Couvre : create, version, deploy, rollback, archive/restore, undeploy, resume, stats, findAll.
