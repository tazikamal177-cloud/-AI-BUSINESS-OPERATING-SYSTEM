/**
 * RolesGuard v2 — Vérifie les rôles requis en utilisant TenantContext typé.
 *
 * Différences avec l'ancien RolesGuard :
 * - Lit le rôle depuis TenantContext (typé) au lieu de request.userRole (string)
 * - Lève une erreur explicite si TenantGuard n'a pas tourné avant
 * - Accepte MemberRole du Prisma (typé) au lieu de string (magic string)
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MemberRole } from '@prisma/client';
import { TenantContext } from './tenant-context';
import { TENANT_CONTEXT_KEY } from './tenant.guard';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<MemberRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const tenant = request[TENANT_CONTEXT_KEY] as TenantContext | undefined;

    if (!tenant) {
      throw new ForbiddenException(
        'Tenant context missing. Add TenantGuard before RolesGuard.',
      );
    }

    if (!tenant.hasRole(...required)) {
      throw new ForbiddenException(
        `Insufficient role: required ${required.join(' or ')}, got ${tenant.role}`,
      );
    }

    return true;
  }
}
