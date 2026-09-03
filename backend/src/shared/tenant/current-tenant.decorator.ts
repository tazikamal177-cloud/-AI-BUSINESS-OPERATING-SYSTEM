/**
 * @CurrentTenant — Decorator pour injecter le TenantContext dans un controller.
 *
 * Usage :
 *   @Get()
 *   async findAll(@CurrentTenant() tenant: TenantContext) {
 *     return this.service.findAll(tenant);
 *   }
 *
 * Le compilateur TypeScript t'empêche d'appeler une méthode de repository
 * qui requiert un tenant sans le fournir.
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenantContext } from './tenant-context';
import { TENANT_CONTEXT_KEY } from './tenant.guard';

export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const request = ctx.switchToHttp().getRequest();
    const tenant = request[TENANT_CONTEXT_KEY] as TenantContext | undefined;

    if (!tenant) {
      throw new Error(
        'TenantContext not found on request. Did you forget to add TenantGuard?',
      );
    }

    return tenant;
  },
);
