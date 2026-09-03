/**
 * Audit module — structured logging of security-sensitive actions.
 *
 * Used by AuthInterceptor + service-level calls (agent CRUD, tool exec, etc.).
 * Writes an `audit_logs` row + emits a structured log line for observability.
 */
export const AUDIT_META_KEY = 'audit:action';
