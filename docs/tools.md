# Tools & Integrations — Phase 7

## Goal
Provide a unified registry of tools the model can call during inference,
backed by either:

- **Built-ins** (in-process handlers): `create_task`, `http_request`,
  `get_current_datetime`, plus the SAV e-commerce suite.
- **Integrations** (per-org): `email` (SMTP), `google_calendar`,
  `crm` (HubSpot-compatible).

Each integration is bound to a per-org set of credentials, encrypted
server-side with AES-256-GCM.

## Architecture

```
Agent Runtime (Phase 4)
        │
        ▼
   ToolExecutor (Phase 4)
   ├─ Resolve tool (DB by slug, then registry)
   ├─ Validate args (Ajv)
   ├─ Enforce risk policy (LOW auto / MEDIUM logged / HIGH → approval task)
   ├─ 30s timeout
   └─ Persist tool_executions + audit_logs

   ToolsService
   ├─ Built-ins registry (in-process)
   ├─ SAV e-commerce handlers
   └─ Integration tools (send_email, create_calendar_event, list_calendar_events,
      create_crm_contact, search_crm_contacts)

   IntegrationsService
   ├─ CRUD Integration
   ├─ Encrypt/decrypt credentials (CredentialsService)
   ├─ Resolve at runtime → ConnectorContext
   └─ Connector.ping() for "test" endpoint

   Connectors
   ├─ EmailConnector  (SMTP, nodemailer)
   ├─ GoogleCalendarConnector (REST + OAuth2 refresh)
   └─ CrmConnector (HubSpot v3 REST)
```

## Credentials — AES-256-GCM

`CredentialsService` derives a 32-byte key from `SECRETS_ENCRYPTION_KEY`
(or `JWT_SECRET` in dev) via `scryptSync`. Each ciphertext is:

```
[12-byte IV][16-byte authTag][ciphertext]   → base64
```

Stored in `integration_credentials.encrypted_value`. Rotation is supported
via `POST /integrations/:id/rotate`.

**Production**: the service refuses to start if `SECRETS_ENCRYPTION_KEY`
is missing.

## Connectors

| ID                | Name                          | Auth                | Notes |
|-------------------|-------------------------------|---------------------|-------|
| `email`           | Email (SMTP)                  | username / password | Works with Gmail app passwords, SendGrid, Mailgun, Postmark, etc. |
| `google_calendar` | Google Calendar               | OAuth2 access token | Auto-refresh on 401 if refresh_token + client credentials present. |
| `crm`             | CRM (HubSpot-compatible)      | Bearer API key      | Configurable `baseUrl` for EspoCRM, Pipedrive, etc. |

Each connector implements a `ping()` method that does a no-op read so
admins can validate credentials from `POST /integrations/:id/test`.

## Tools registered in the global registry

| Slug                      | Risk    | Source         | Notes |
|---------------------------|---------|----------------|-------|
| `create_task`             | LOW     | BUILT_IN       | Creates a `Task` row tied to the agent & conversation. |
| `http_request`            | MEDIUM  | BUILT_IN       | Arbitrary outbound fetch (no SSRF whitelist yet). |
| `get_current_datetime`    | LOW     | BUILT_IN       | Returns ISO + date. |
| `send_email`              | MEDIUM  | INTEGRATION    | Requires `email` integration. |
| `create_calendar_event`   | MEDIUM  | INTEGRATION    | Requires `google_calendar` integration. |
| `list_calendar_events`    | LOW     | INTEGRATION    | Requires `google_calendar` integration. |
| `create_crm_contact`      | MEDIUM  | INTEGRATION    | Requires `crm` integration. |
| `search_crm_contacts`     | LOW     | INTEGRATION    | Requires `crm` integration. |
| SAV e-commerce suite      | mixed   | SAV_ECOMMERCE  | See `tools/ecommerce/sav.tools.ts`. |

## Risk policy

The `ToolExecutor` enforces a 3-tier risk model:

- **LOW** — auto-execute, audit as `tool.execution`.
- **MEDIUM** — auto-execute, audit as `tool.execution.medium_risk`.
- **HIGH** — *blocked*; a `Task` of type `REQUIRES_APPROVAL` is created and
  the model is told the call was queued. A human can approve via
  `POST /tasks/:id/approve` (Phase 4) which will replay the call.

> Tools resolved from the in-memory registry cannot be HIGH risk (they
> have no row to anchor the approval task to). The executor rejects HIGH
> registry-resolved tools with `TOOL_HIGH_RISK_UNTRACKED`.

## Routes — `/integrations`

All routes are under `/integrations` and require `JwtAuthGuard` +
`OrganizationGuard`. RLS scopes to the current org.

| Method | Path                              | Purpose                                   |
|--------|-----------------------------------|-------------------------------------------|
| GET    | `/integrations/connectors`        | List supported providers                  |
| GET    | `/integrations`                   | List the org's integrations               |
| GET    | `/integrations/:id`               | Get one                                   |
| POST   | `/integrations`                   | Create (body: provider, name, type, credentials) |
| PATCH  | `/integrations/:id`               | Rename / update configuration             |
| POST   | `/integrations/:id/rotate`        | Rotate a single credential (key + value)  |
| POST   | `/integrations/:id/test`          | `ping()` the connector                    |
| DELETE | `/integrations/:id`               | Archive (status=INACTIVE)                 |

### Create example

```bash
curl -X POST $URL/integrations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "email",
    "name": "Gmail Outbound",
    "type": "COMMUNICATION",
    "credentials": {
      "host": "smtp.gmail.com",
      "port": "587",
      "user": "[email protected]",
      "pass": "app-password",
      "fromName": "Sales"
    }
  }'
```

## Routes — `/tools`

The existing tools controller exposes:

| Method | Path                          |
|--------|-------------------------------|
| GET    | `/tools`                      |
| GET    | `/tools/:id`                  |
| POST   | `/tools`                      |
| PATCH  | `/tools/:id`                  |
| DELETE | `/tools/:id`                  |
| POST   | `/tools/:id/attach`           |
| POST   | `/tools/:id/detach`           |
| GET    | `/tools/ecommerce/sav`        |

(Attaching a tool to an agent happens via `POST /agents/:id/tools` from
Phase 5; the `/tools/:id/attach` route is kept as a convenience alias.)

## Tests

- `credentials.spec.ts` — roundtrip, random IV, tampered ciphertext, unicode,
  invalid input.

```
PASS src/modules/integrations/__tests__/credentials.spec.ts
Tests: 6 passed, 6 total
```

## Known limitations & next steps

- SSRF allowlist for `http_request` is deferred to Phase 10.
- OAuth callback flow for Google Calendar is not built — admins paste
  access tokens manually (or set up a long-lived token).
- Tool **analytics** (success rate, p95 duration) is not aggregated yet.
- No retry/backoff for transient provider failures (5xx returns are
  surfaced to the model, which can choose to retry).
- BullMQ ingestion for large documents is wired in the knowledge module
  but not yet for tool re-execution queues.
