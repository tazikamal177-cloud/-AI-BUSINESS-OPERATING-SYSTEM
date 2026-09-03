/**
 * PermissionService — Résout l'ensemble des permissions d'un rôle.
 *
 * Pourquoi cette classe existe :
 * - Centralise la matrice rôle → permissions en UN seul endroit
 * - Permet de modifier les permissions sans toucher aux guards
 * - Facilite l'audit : tu vois tout d'un coup d'œil qui peut faire quoi
 * - Extensibilité : ajouter un rôle custom en v2 = ajouter une ligne ici
 *
 * Règle pédagogique : un système RBAC qui marche n'a JAMAIS
 * de permissions dispersées dans 10 fichiers. Tout est ici.
 */

import { Injectable } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { Permission } from './tenant-context';

const ROLE_PERMISSIONS: Record<MemberRole, ReadonlySet<Permission>> = {
  OWNER: new Set<Permission>([
    'agent:create',
    'agent:read',
    'agent:update',
    'agent:delete',
    'agent:deploy',
    'knowledge:read',
    'knowledge:write',
    'workflow:create',
    'workflow:read',
    'workflow:run',
    'conversation:create',
    'conversation:read',
    'integration:read',
    'integration:write',
    'member:invite',
    'member:remove',
    'member:update-role',
    'billing:read',
    'billing:write',
    'audit:read',
    'settings:read',
    'settings:write',
  ]),

  ADMIN: new Set<Permission>([
    'agent:create',
    'agent:read',
    'agent:update',
    'agent:delete',
    'agent:deploy',
    'knowledge:read',
    'knowledge:write',
    'workflow:create',
    'workflow:read',
    'workflow:run',
    'conversation:create',
    'conversation:read',
    'integration:read',
    'integration:write',
    'member:invite',
    'member:remove',
    'billing:read',
    'settings:read',
    'settings:write',
  ]),

  MANAGER: new Set<Permission>([
    'agent:create',
    'agent:read',
    'agent:update',
    'agent:deploy',
    'knowledge:read',
    'knowledge:write',
    'workflow:create',
    'workflow:read',
    'workflow:run',
    'conversation:create',
    'conversation:read',
    'integration:read',
    'settings:read',
  ]),

  OPERATOR: new Set<Permission>([
    'agent:read',
    'knowledge:read',
    'workflow:read',
    'conversation:create',
    'conversation:read',
    'settings:read',
  ]),

  VIEWER: new Set<Permission>([
    'agent:read',
    'knowledge:read',
    'workflow:read',
    'conversation:read',
    'settings:read',
  ]),
};

@Injectable()
export class PermissionService {
  resolveForRole(role: MemberRole): ReadonlySet<Permission> {
    const permissions = ROLE_PERMISSIONS[role];
    if (!permissions) {
      throw new Error(`Unknown role: ${role}`);
    }
    return permissions;
  }

  hasPermission(role: MemberRole, permission: Permission): boolean {
    return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
  }

  listRoles(): MemberRole[] {
    return Object.keys(ROLE_PERMISSIONS) as MemberRole[];
  }
}
