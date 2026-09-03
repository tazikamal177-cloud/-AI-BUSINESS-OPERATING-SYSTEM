/**
 * @Permissions — Decorator pour exiger une permission fine sur un endpoint.
 *
 * Usage :
 *   @Permissions('agent:create')
 *   @Post()
 *   async create(@Body() dto: CreateAgentDto, @CurrentTenant() tenant) {
 *     // Le guard vérifie que tenant.hasPermission('agent:create')
 *   }
 *
 * Pourquoi ne pas utiliser @Roles :
 * - Les rôles sont une vue "macro" (qui es-tu ?)
 * - Les permissions sont une vue "micro" (que peux-tu faire ?)
 * - En RBAC mature, on code contre les permissions, pas contre les rôles
 * - Demain si tu changes la matrice, les endpoints s'adaptent automatiquement
 */

import { SetMetadata } from '@nestjs/common';
import { Permission } from './tenant-context';

export const PERMISSIONS_KEY = 'requiredPermissions';

export const Permissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
