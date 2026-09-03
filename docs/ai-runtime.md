# AIBOS — AI Runtime (Phase 4)

> The shared kernel that powers every agent in the platform.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  HTTP request                                                        │
│  POST /api/v1/agents/:id/chat  (SSE)  | POST /api/v1/agents/:id/test │
└────────────────────────┬─────────────────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  AgentRuntimeService.run(ctx, onEvent)                               │
│  ─────────────────────────────────────                                │
│  1. Load agent (and optional pinned deployed version)                │
│  2. QuotaService.enforce() → pre-flight check                        │
│  3. Build tool specs from agent_tools                                │
│  4. RAG retrieval (top-5 chunks, cosine on pgvector)                 │
│  5. Build system prompt + memory + RAG context                       │
│  6. Tool-calling loop (model ↔ ToolExecutor, max 10 iterations)      │
│  7. Persist messages, record UsageRecord, audit_log                  │
│  8. Push to short-term memory (Redis)                                │
└────────────────────────┬─────────────────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  AiGatewayService                                                    │
│  ──────────────────                                                  │
│  Registry of AIProvider implementations                             │
│    ├─ OpenAiProvider        (gpt-4o, gpt-4o-mini, o1…)               │
│    ├─ AnthropicProvider     (claude-3.5-sonnet, claude-3.5-haiku)    │
│    └─ GeminiProvider        (gemini-1.5-pro, gemini-1.5-flash)       │
│  Catalogue (models, pricing USD/1M tokens, capabilities)             │
│  Embedding with auto-fallback to OpenAI when provider lacks embed API│
└──────────────────────────────────────────────────────────────────────┘
```

## Tool calling

`ToolExecutor` is the single point of execution:

1. **Resolve** the tool by `slug` from `tools` (built-in or org-specific)
2. **Validate** arguments against the JSON schema (Ajv, strict)
3. **Risk policy** (per tool):
   - `LOW` → execute, audit `tool.execution`
   - `MEDIUM` → execute, audit `tool.execution.medium_risk`, notify
   - `HIGH` → **block**, create `Task(REQUIRES_APPROVAL)`, audit `tool.execution.requires_approval`
4. **Timeout** 30 s per tool (configurable per tool in `tools.timeout_ms` post-MVP)
5. **Record** row in `tool_executions` + audit log
6. Return normalized result (or a `{ blocked: true, requiresApproval: true, taskId }` envelope)

The runtime feeds tool results back to the model until either:
- the model emits no `tool_calls` (final response), or
- `MAX_TOOL_ITERATIONS` (10) is reached (safety net).

## Quota

Per-organization monthly token limit read from `plans.limits.monthlyTokens`.

- `QuotaService.getStatus(organizationId)` → cached 30 s in Redis
- `QuotaService.enforce(organizationId, estimatedTokens)` → throws `{ code: 'QUOTA_EXCEEDED' }` if `used + estimated > limit`
- `UsageService.record(...)` invalidates the cache after each call

## Usage tracking

Every call to a provider (chat or embedding) appends a `usage_records` row:

```ts
{
  organizationId, userId, agentId, agentVersionId, conversationId, messageId,
  modelProvider, modelName,
  inputTokens, outputTokens, totalTokens, estimatedCost,
  operation: 'agent_execution' | 'agent_test' | 'embedding' | 'workflow_run',
  monthBucket: 'YYYY-MM',
  metadata: { durationMs, iterations, … }
}
```

The `monthBucket` index makes per-org aggregation for analytics/triggers sub-second.

## Memory

- **Short-term** (Redis, 30 min sliding) — last 50 messages of a conversation, used for in-flight context
- **Long-term** (`memories`, type=LONG_TERM) — user-scoped facts, with embeddings (raw SQL for the `vector` column)
- **Business** (`memories`, type=BUSINESS) — org-scoped facts

The runtime writes short-term memory after each turn. Long-term and business memory are user/org-controlled (manual UI in Phase 5+).

## SSE stream contract

`POST /api/v1/agents/:agentId/chat` returns `text/event-stream`. Events:

| event | payload |
|---|---|
| `message.start` | (none) |
| `message.delta` | `{ content: string }` |
| `tool.call` | `{ id, name }` |
| `tool.result` | `{ id, name, ok, output?, error?, requiresApproval?, taskId? }` |
| `message.done` | `{ messageId, usage, citations, toolCalls, error? }` |
| `error` | `{ code, message }` |

The client should never display internal reasoning; only the `content` deltas and tool results.

## Routes

| Method | Path | Role |
|---|---|---|
| POST | `/api/v1/agents/:id/test` | member (playground) |
| POST | `/api/v1/agents/:id/chat` | member (SSE) |
| GET | `/api/v1/agents/templates` | member (global templates) |
| GET | `/api/v1/usage/current` | OWNER/ADMIN |
| GET | `/api/v1/usage/history` | OWNER/ADMIN |

## Quota headers (response)

The chat response includes:

```
X-Quota-Used:     <tokens>
X-Quota-Limit:    <tokens|null>
X-Quota-Month:    YYYY-MM
```

## Security & multi-tenant

- All RLS policies from `prisma/sql/rls.sql` apply (defense in depth).
- The runtime never logs the user's message text to the audit log (only metadata: `tokens`, `costUsd`, `durationMs`).
- Tool results are never echoed in the audit log (may contain PII); they are persisted in `messages` only.

## Testing

```bash
npm test                   # unit (provider mocks)
npm run test:e2e           # end-to-end (smoke + cross-tenant)
```

Unit tests live in `test/*.spec.ts` and use a `FakeProvider` that records calls.

## Limitations (Phase 4)

- Memory long-term extraction is not automatic yet (Phase 5+).
- No parallel tool execution (sequential loop).
- No re-ranking of RAG results (raw cosine).
- Streaming back-pressure: client disconnect terminates the run cleanly but the LLM call may not be cancelled mid-flight (provider-dependent).
