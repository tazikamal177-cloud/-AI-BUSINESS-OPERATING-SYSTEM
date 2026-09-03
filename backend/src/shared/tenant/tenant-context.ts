/**
 * TenantContext — Contexte de tenant immutable propagé via NestJS.
 *
 * Pourquoi cette classe existe :
 * - Empêche un service de modifier le tenant en cours de route
 * - Centralise toutes les infos de sécurité (org, user, role, permissions)
 * - Permet aux repositories de demander explicitement un tenant
 *   au lieu d'espérer que le caller ait filtré
 *
 * L'objet est gelé à la construction (Object.freeze).
 */

import { MemberRole } from '@prisma/client';

export type Permission =
  | 'agent:create'
  | 'agent:read'
  | 'agent:update'
  | 'agent:delete'
  | 'agent:deploy'
  | 'knowledge:read'
  | 'knowledge:write'
  | 'workflow:create'
  | 'workflow:read'
  | 'workflow:run'
  | 'conversation:create'
  | 'conversation:read'
  | 'integration:read'
  | 'integration:write'
  | 'member:invite'
  | 'member:remove'
  | 'member:update-role'
  | 'billing:read'
  | 'billing:write'
  | 'audit:read'
  | 'settings:read'
  | 'settings:write';

export class TenantContext {
  constructor(
    public readonly organizationId: string,
    public readonly userId: string,
    public readonly role: MemberRole,
    public readonly permissions: ReadonlySet<Permission>,
  ) {
    if (!organizationId) {
      throw new Error('TenantContext: organizationId is required');
    }
    if (!userId) {
      throw new Error('TenantContext: userId is required');
    }
    if (!role) {
      throw new Error('TenantContext: role is required');
    }
    Object.freeze(this);
    Object.freeze(this.permissions);
  }

  hasRole(...roles: MemberRole[]): boolean {
    return roles.includes(this.role);
  }

  hasPermission(permission: Permission): boolean {
    return this.permissions.has(permission);
  }

  requireRole(...roles: MemberRole[]): void {
    if (!this.hasRole(...roles)) {
      throw new Error(
        `Access denied: required role ${roles.join(' or ')}, got ${this.role}`,
      );
    }
  }

  requirePermission(permission: Permission): void {
    if (!this.hasPermission(permission)) {
      throw new Error(`Access denied: missing permission ${permission}`);
    }
  }

  toJSON() {
    return {
      organizationId: this.organizationId,
      userId: this.userId,
      role: this.role,
      permissions: Array.from(this.permissions),
    };
  }
}
