/**
 * PermissionsGuard — Vérifie que le TenantContext possède les permissions requises.
 *
 * Doit être appliqué APRÈS TenantGuard dans la chaîne.
 *
 * Note : on garde @Roles pour la rétrocompatibilité avec l'existant,
 * mais @Permissions est la voie recommandée pour le nouveau code.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantContext } from './tenant-context';
import { TENANT_CONTEXT_KEY } from './tenant.guard';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { Permission } from './tenant-context';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const tenant = request[TENANT_CONTEXT_KEY] as TenantContext | undefined;

    if (!tenant) {
      throw new ForbiddenException(
        'Tenant context missing. Add TenantGuard before PermissionsGuard.',
      );
    }

    const missing = required.filter((p) => !tenant.hasPermission(p));

    if (missing.length > 0) {
      throw new ForbiddenException(
        `Missing permissions: ${missing.join(', ')}`,
      );
    }

    return true;
  }
}
