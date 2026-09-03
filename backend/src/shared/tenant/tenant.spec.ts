/**
 * Tests unitaires du système de tenancy.
 *
 * Ces tests ne touchent PAS la DB. Ils valident la logique pure :
 * - TenantContext est bien immutable
 * - PermissionService résout correctement les permissions par rôle
 * - hasRole / hasPermission fonctionnent comme attendu
 *
 * Pour tester le TenantGuard (avec DB), voir test/security/tenant-isolation.e2e-spec.ts
 */

import { MemberRole } from '@prisma/client';
import { TenantContext, Permission } from './tenant-context';
import { PermissionService } from './permission.service';

describe('TenantContext', () => {
  const makeContext = (
    overrides: Partial<{
      organizationId: string;
      userId: string;
      role: MemberRole;
      permissions: Set<Permission>;
    }> = {},
  ): TenantContext => {
    return new TenantContext(
      overrides.organizationId ?? 'org-1',
      overrides.userId ?? 'user-1',
      overrides.role ?? MemberRole.OPERATOR,
      overrides.permissions ?? new Set(['agent:read']),
    );
  };

  describe('immutability', () => {
    it('should throw if organizationId is missing', () => {
      expect(() => {
        new TenantContext('', 'user-1', MemberRole.OPERATOR, new Set());
      }).toThrow('organizationId is required');
    });

    it('should throw if userId is missing', () => {
      expect(() => {
        new TenantContext('org-1', '', MemberRole.OPERATOR, new Set());
      }).toThrow('userId is required');
    });

    it('should throw if role is missing', () => {
      expect(() => {
        new TenantContext('org-1', 'user-1', null as any, new Set());
      }).toThrow('role is required');
    });

    it('should freeze the object at construction', () => {
      const ctx = makeContext();
      expect(Object.isFrozen(ctx)).toBe(true);
      expect(Object.isFrozen(ctx.permissions)).toBe(true);
    });

    it('should not allow mutation of properties', () => {
      const ctx = makeContext();
      expect(() => {
        (ctx as any).organizationId = 'org-2';
      }).toThrow(TypeError);
    });
  });

  describe('hasRole', () => {
    it('should return true if role matches', () => {
      const ctx = makeContext({ role: MemberRole.ADMIN });
      expect(ctx.hasRole(MemberRole.ADMIN)).toBe(true);
    });

    it('should return true if role matches one of many', () => {
      const ctx = makeContext({ role: MemberRole.OWNER });
      expect(ctx.hasRole(MemberRole.OWNER, MemberRole.ADMIN)).toBe(true);
    });

    it('should return false if role does not match', () => {
      const ctx = makeContext({ role: MemberRole.VIEWER });
      expect(ctx.hasRole(MemberRole.OWNER, MemberRole.ADMIN)).toBe(false);
    });
  });

  describe('hasPermission', () => {
    it('should return true if permission is granted', () => {
      const ctx = makeContext({
        permissions: new Set(['agent:read', 'agent:create']),
      });
      expect(ctx.hasPermission('agent:read')).toBe(true);
    });

    it('should return false if permission is missing', () => {
      const ctx = makeContext({
        permissions: new Set(['agent:read']),
      });
      expect(ctx.hasPermission('agent:delete')).toBe(false);
    });
  });

  describe('requirePermission', () => {
    it('should not throw if permission is granted', () => {
      const ctx = makeContext({
        permissions: new Set(['agent:read']),
      });
      expect(() => ctx.requirePermission('agent:read')).not.toThrow();
    });

    it('should throw if permission is missing', () => {
      const ctx = makeContext({
        permissions: new Set(['agent:read']),
      });
      expect(() => ctx.requirePermission('agent:delete')).toThrow(
        /agent:delete/,
      );
    });
  });

  describe('toJSON', () => {
    it('should serialize to a plain object', () => {
      const ctx = makeContext({
        organizationId: 'org-x',
        userId: 'user-y',
        role: MemberRole.MANAGER,
        permissions: new Set(['agent:read', 'workflow:create']),
      });

      expect(ctx.toJSON()).toEqual({
        organizationId: 'org-x',
        userId: 'user-y',
        role: MemberRole.MANAGER,
        permissions: ['agent:read', 'workflow:create'],
      });
    });
  });
});

describe('PermissionService', () => {
  let service: PermissionService;

  beforeEach(() => {
    service = new PermissionService();
  });

  describe('resolveForRole', () => {
    it('should return a non-empty set for OWNER', () => {
      const perms = service.resolveForRole(MemberRole.OWNER);
      expect(perms.size).toBeGreaterThan(0);
    });

    it('should return a subset of permissions for VIEWER', () => {
      const ownerPerms = service.resolveForRole(MemberRole.OWNER);
      const viewerPerms = service.resolveForRole(MemberRole.VIEWER);

      expect(viewerPerms.size).toBeLessThan(ownerPerms.size);
    });

    it('VIEWER should not have write permissions', () => {
      const perms = service.resolveForRole(MemberRole.VIEWER);
      expect(perms.has('agent:create')).toBe(false);
      expect(perms.has('agent:delete')).toBe(false);
      expect(perms.has('settings:write')).toBe(false);
    });

    it('OWNER should have billing permissions', () => {
      const perms = service.resolveForRole(MemberRole.OWNER);
      expect(perms.has('billing:read')).toBe(true);
      expect(perms.has('billing:write')).toBe(true);
    });

    it('ADMIN should not have billing:write', () => {
      const perms = service.resolveForRole(MemberRole.ADMIN);
      expect(perms.has('billing:write')).toBe(false);
    });

    it('should throw for unknown role', () => {
      expect(() => {
        service.resolveForRole('UNKNOWN' as MemberRole);
      }).toThrow('Unknown role');
    });
  });

  describe('hasPermission', () => {
    it('should match the resolved set', () => {
      expect(
        service.hasPermission(MemberRole.OPERATOR, 'conversation:create'),
      ).toBe(true);
      expect(
        service.hasPermission(MemberRole.OPERATOR, 'settings:write'),
      ).toBe(false);
    });
  });

  describe('listRoles', () => {
    it('should return all 5 roles', () => {
      const roles = service.listRoles();
      expect(roles).toHaveLength(5);
      expect(roles).toContain(MemberRole.OWNER);
      expect(roles).toContain(MemberRole.VIEWER);
    });
  });

  describe('permission hierarchy (sanity)', () => {
    it('OWNER > ADMIN > MANAGER > OPERATOR > VIEWER (in number of perms)', () => {
      const sizes = [
        service.resolveForRole(MemberRole.OWNER).size,
        service.resolveForRole(MemberRole.ADMIN).size,
        service.resolveForRole(MemberRole.MANAGER).size,
        service.resolveForRole(MemberRole.OPERATOR).size,
        service.resolveForRole(MemberRole.VIEWER).size,
      ];

      for (let i = 1; i < sizes.length; i++) {
        expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]);
      }
    });
  });
});
