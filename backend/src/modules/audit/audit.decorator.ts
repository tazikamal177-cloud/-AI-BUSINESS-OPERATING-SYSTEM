import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit:meta';

export interface AuditMeta {
  action: string;
  resourceType: string;
  /** SpEL-like path to extract resource id from the response, e.g. "data.id" */
  resourceIdFrom?: string;
}

/**
 * Mark a controller method to be auto-audited on success.
 * Usage:
 *   @Audit({ action: 'agent.create', resourceType: 'agent', resourceIdFrom: 'id' })
 */
export const Audit = (meta: AuditMeta) => SetMetadata(AUDIT_KEY, meta);
