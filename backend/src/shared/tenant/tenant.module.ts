/**
 * TenantModule — Module global qui exporte tout le système de tenancy.
 *
 * En l'important dans AppModule, tu peux utiliser partout :
 * - TenantGuard (global)
 * - @CurrentTenant() decorator
 * - @Public() decorator
 * - @Roles(), @Permissions()
 * - RolesGuard, PermissionsGuard
 * - TenantContext (injection)
 *
 * C'est un module GLOBAL : pas besoin de le réimporter dans chaque module métier.
 */

import { Global, Module } from '@nestjs/common';
import { PermissionService } from './permission.service';
import { TenantGuard } from './tenant.guard';
import { RolesGuard } from './roles.guard';
import { PermissionsGuard } from './permissions.guard';

@Global()
@Module({
  providers: [
    PermissionService,
    TenantGuard,
    RolesGuard,
    PermissionsGuard,
  ],
  exports: [
    PermissionService,
    TenantGuard,
    RolesGuard,
    PermissionsGuard,
  ],
})
export class TenantModule {}
