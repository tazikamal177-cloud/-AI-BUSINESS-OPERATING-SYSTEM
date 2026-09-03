# Workflow Engine — Phase 8

## Goal
Let organizations chain agents, tools, conditions and delays into
production-grade automations. Runs are auditable, retriable and
deterministically versioned (each run snapshots the graph at start time).

## Architecture

```
                            ┌─────────────────┐
   Trigger (webhook/manual) │ WorkflowsService │
                            └────────┬────────┘
                                     │ 1. validate graph
                                     │ 2. snapshot + create WorkflowRun
                                     │ 3. fire WorkflowRunner
                                     ▼
                            ┌─────────────────┐
                            │ WorkflowRunner  │  (depth-first traversal)
                            └────────┬────────┘
                                     │
                  ┌──── Trigger ────┴──── Action ───── Agent ──── Condition ─── Wait ─── Parallel ── End ────┐
                  ▼                ▼               ▼              ▼             ▼           ▼          ▼
              trigger.handler  action.handler  agent.handler  cond.handler  wait.handler  parallel.handler end.handler
              (set vars)       (ToolExecutor)  (AgentRuntime)  (set _lastCond)  (sleep)    (fan-out)    (no-op)
                  │                │               │              │             │           │          │
                  └────────────────┴───────┬───────┴──────────────┴─────────────┴───────────┴──────────┘
                                           ▼
                                WorkflowRunLog (per-node audit)
                                WorkflowRun.context (mutable vars)
```

## Graph definition

A workflow is a JSON object stored in `workflows.definition`:

```json
{
  "nodes": [
    { "id": "t", "type": "TRIGGER", "name": "Webhook" },
    { "id": "a", "type": "AGENT",  "name": "Triage", "agentId": "…" },
    { "id": "c", "type": "CONDITION", "name": "High value?",
      "configuration": { "variable": "agentReply", "op": "gt", "value": 0 } },
    { "id": "x", "type": "ACTION", "name": "Notify sales",
      "configuration": { "tool": "send_email", "arguments": { "to": "{trigger.email}", "subject": "Hot lead" }, "outputAs": "sent" } },
    { "id": "w", "type": "WAIT", "name": "Cool down", "configuration": { "ms": 60000 } },
    { "id": "e", "type": "END", "name": "Done" }
  ],
  "edges": [
    { "id": "e1", "sourceNodeId": "t", "targetNodeId": "a" },
    { "id": "e2", "sourceNodeId": "a", "targetNodeId": "c" },
    { "id": "e3", "sourceNodeId": "c", "targetNodeId": "x", "condition": { "kind": "expression", "expression": "_lastCondition === true" } },
    { "id": "e4", "sourceNodeId": "c", "targetNodeId": "w", "condition": { "kind": "expression", "expression": "_lastCondition === false" } },
    { "id": "e5", "sourceNodeId": "x", "targetNodeId": "w" },
    { "id": "e6", "sourceNodeId": "w", "targetNodeId": "e" }
  ]
}
```

### Validation (`graph.validation.ts`)

- Exactly one `TRIGGER` node.
- All edge endpoints must reference existing nodes.
- No self-loops, no cycles (DFS with grey/black coloring).
- At least one `END` reachable from the trigger.

## Node handlers

| Type      | Config                                                       | Effect |
|-----------|--------------------------------------------------------------|--------|
| TRIGGER   | (none)                                                       | Copies `trigger` payload into `vars.trigger`. |
| END       | (none)                                                       | Halts the run. |
| WAIT      | `{ ms }` or `{ until }` (capped at 1h)                       | Pauses inline; long waits should be split. |
| AGENT     | `{ agentId, message?, outputAs? }` (message supports `{var}`)| Calls `AgentRuntimeService.run()`. |
| ACTION    | `{ tool, arguments?, outputAs?, retries? }`                 | Calls `ToolExecutor.execute()` with optional linear-backoff retries. |
| CONDITION | `{ path, equals? \| exists? }` or `{ variable, op, value }`  | Writes `vars._lastCondition` for the runner to pick the next edge. |
| PARALLEL  | (none)                                                       | Runner fan-outs: all matching edges executed in parallel. |

## Edge conditions (`graph.conditions.ts`)

```ts
{ kind: 'always' }
{ kind: 'jsonpath', path: '$.user.plan', equals: 'enterprise' }
{ kind: 'jsonpath', path: '$.data.error', exists: false }
{ kind: 'expression', expression: '_lastCondition === true && {trigger.amount} > 100' }
```

`expression` is sanitized (drops `;`, backticks, `require`, `process.`,
`global.`, `window.`) and `Function`-eval'd against a snapshot of the
context. Use with care.

## Runs

| Field          | Type    | Notes |
|----------------|---------|-------|
| `status`       | enum    | PENDING → RUNNING → COMPLETED / FAILED / CANCELLED |
| `workflowVersion` | int  | Frozen at run start |
| `snapshot`     | JSONB   | The graph definition the runner executes against |
| `context`      | JSONB   | Mutable `vars` shared across nodes (logged at completion) |
| `currentNode`  | UUID    | The node the runner was on at the last log row |
| `error`        | string  | Populated on FAILED |
| `triggerData`  | JSONB   | Initial payload (webhook body, manual args, etc.) |

## Routes (`/api/v1/workflows`)

All require `JwtAuthGuard` + `OrganizationGuard`.

| Method | Path                                  | Notes |
|--------|---------------------------------------|-------|
| GET    | `/workflows`                          | List org workflows |
| GET    | `/workflows/:id`                      | With nodes/edges/last 10 runs |
| POST   | `/workflows`                          | Validate + persist (DRAFT) |
| PATCH  | `/workflows/:id`                      | Update fields, re-validate, version++ on graph edit |
| POST   | `/workflows/:id/activate`             | Set status=ACTIVE (validates first) |
| POST   | `/workflows/:id/pause`                | Set status=PAUSED |
| DELETE | `/workflows/:id`                      | Soft archive |
| POST   | `/workflows/:id/run`                  | Manual run (body: `{ trigger: {...} }`) |
| GET    | `/workflows/:id/runs`                 | List last 50 runs |
| GET    | `/workflows/:id/runs/:runId`          | Run + logs |
| POST   | `/workflows/:id/runs/:runId/cancel`   | Best-effort cancel |

## Webhooks (public, HMAC-signed)

| Method | Path                                          | Auth |
|--------|-----------------------------------------------|------|
| POST   | `/api/v1/webhooks/workflows/:workflowId`      | `X-AIBOS-Signature: sha256=<hex>` (HMAC of raw body, secret from `triggerConfig.secret`) |

The secret is set per workflow in `triggerConfig.secret`. It is stored in
JSONB and is never returned to clients (you can rotate it via PATCH).

## RLS & multi-tenant

- `workflows.organization_id` → direct RLS check.
- `workflow_runs.organization_id` → direct RLS check.
- `workflow_run_logs` and child tables → indirect via `workflow_runs.id`.
- Webhook endpoint bypasses the JWT guard but the signature is the only
  access control. The handler reads the workflow by id (no RLS), so the
  secret becomes the per-tenant shared key.

## Tests

- `graph.spec.ts` — validation (12 cases), JSONPath, edge conditions.

```
PASS src/modules/workflows/engine/__tests__/graph.spec.ts
Tests: 12 passed, 12 total
```

## Known limitations & next steps

- The runner is in-process. Long-running workflows (> 1 min) and fan-outs
  with many parallel branches should move to BullMQ (Phase 7 deferred).
- There is no human-in-the-loop step (e.g. approval) — we use the
  `create_task` tool with `requires_approval` for that.
- Schedule triggers (`SCHEDULE`) are not scheduled; they will be wired to
  BullMQ repeatable jobs in Phase 7/Phase 10.
- Conditional edges cannot reference node-local outputs (only `vars.*`).
- The `WorkflowRun.organization_id` column was added in Phase 8 — the
  database must be re-migrated before first run.
