/**
 * Barrel export pour le système de tenancy.
 *
 * Import depuis n'importe où avec :
 *   import { TenantContext, CurrentTenant, Roles, ... } from '@/shared/tenant';
 */

export { TenantContext, Permission } from './tenant-context';
export { PermissionService } from './permission.service';
export { TenantGuard, TENANT_CONTEXT_KEY, SKIP_TENANT_KEY } from './tenant.guard';
export { CurrentTenant } from './current-tenant.decorator';
export { Public } from './public.decorator';
export { Roles, ROLES_KEY } from './roles.decorator';
export { RolesGuard } from './roles.guard';
export { Permissions, PERMISSIONS_KEY } from './permissions.decorator';
export { PermissionsGuard } from './permissions.guard';
export { TenantModule } from './tenant.module';
