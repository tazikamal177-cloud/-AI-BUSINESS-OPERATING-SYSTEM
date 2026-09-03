/**
 * TenantGuard — Guard global qui valide et résout le tenant.
 *
 * Ce qu'il fait :
 * 1. Vérifie que l'utilisateur est authentifié (JwtAuthGuard doit passer avant)
 * 2. Lit l'organizationId depuis le header X-Organization-Id ou le JWT
 * 3. Vérifie en DB que l'utilisateur est bien membre de cette organisation
 * 4. Construit un TenantContext immutable et l'attache à la requête
 *
 * Ce qu'il NE fait PAS :
 * - Il ne vérifie pas les permissions fines (c'est le rôle du @Permissions decorator)
 * - Il ne vérifie pas les rôles (c'est le rôle du @Roles decorator)
 *
 * Pourquoi ce guard est critique :
 * - Sans lui, n'importe quel endpoint aurait accès à n'importe quel tenant
 * - C'est la PREMIÈRE ligne de défense contre les fuites inter-tenant
 * - Un endpoint sans ce guard = faille de sécurité par construction
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { Inject } from '@nestjs/common';
import { PermissionService } from './permission.service';
import { TenantContext } from './tenant-context';

export { TenantContext };
export const TENANT_CONTEXT_KEY = 'tenantContext';
export const SKIP_TENANT_KEY = 'skipTenantGuard';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    @Inject('PRISMA_CLIENT') private readonly prisma: PrismaClient,
    private readonly permissionService: PermissionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.sub) {
      throw new UnauthorizedException('Authentication required');
    }

    const requestedOrgId =
      (request.headers['x-organization-id'] as string | undefined) ||
      (user.org as string | undefined);

    if (!requestedOrgId) {
      throw new ForbiddenException(
        'Organization not specified. Send X-Organization-Id header.',
      );
    }

    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: requestedOrgId,
          userId: user.sub,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('Not a member of this organization');
    }

    const permissions = this.permissionService.resolveForRole(membership.role);

    const tenantContext = new TenantContext(
      membership.organizationId,
      membership.userId,
      membership.role,
      permissions,
    );

    request[TENANT_CONTEXT_KEY] = tenantContext;

    return true;
  }
}
