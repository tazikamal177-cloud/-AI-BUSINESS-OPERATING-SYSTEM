/**
 * Connector contract. Each provider (Gmail, Google Calendar, HubSpot, etc.)
 * implements this. Connectors are stateless — all per-org secrets are passed
 * in via `ctx.credentials` (decrypted on the fly by IntegrationService).
 */
export interface ConnectorContext {
  organizationId: string;
  /** Decrypted credentials for the connector. Shape is connector-specific. */
  credentials: Record<string, string>;
  /** Free-form configuration set at integration-creation time. */
  config?: Record<string, unknown>;
  /** Hard per-request timeout (ms). */
  timeoutMs?: number;
}

export interface ConnectorResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  /** Connector-specific raw error code for diagnostics. */
  code?: string;
}

export interface Connector {
  /** Provider id, e.g. 'email', 'google_calendar', 'hubspot'. */
  readonly id: string;
  /** Human-friendly provider name. */
  readonly name: string;
  /**
   * Quick reachability check (used by `POST /integrations/:id/test`).
   * Should NOT mutate any external state.
   */
  ping(ctx: ConnectorContext): Promise<ConnectorResult>;
}
