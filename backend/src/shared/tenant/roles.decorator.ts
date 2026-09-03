/**
 * @Roles — Decorator pour exiger un ou plusieurs rôles sur un endpoint.
 *
 * Usage :
 *   @Roles(MemberRole.OWNER)
 *   @Delete(':id')
 *   async delete(@Param('id') id: string, @CurrentTenant() tenant) {
 *     // Seuls les OWNER peuvent supprimer
 *   }
 *
 * Note : on importe MemberRole depuis @prisma/client pour avoir
 * les types exacts et éviter les magic strings.
 */

import { SetMetadata } from '@nestjs/common';
import { MemberRole } from '@prisma/client';

export const ROLES_KEY = 'requiredRoles';

export const Roles = (...roles: MemberRole[]) => SetMetadata(ROLES_KEY, roles);
