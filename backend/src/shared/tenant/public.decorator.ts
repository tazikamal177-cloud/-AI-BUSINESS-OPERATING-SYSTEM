/**
 * @Public — Marque un endpoint comme ne nécessitant pas le TenantGuard.
 *
 * Usage :
 *   @Public()
 *   @Get('health')
 *   health() { return { ok: true }; }
 *
 * À utiliser UNIQUEMENT pour :
 * - Health checks
 * - Webhooks (Shopify, etc.) où le tenant n'est pas encore connu
 * - Routes vraiment globales (ex: liste des plans)
 *
 * NE JAMAIS utiliser sur un endpoint qui touche à des données métier.
 */

import { SetMetadata } from '@nestjs/common';
import { SKIP_TENANT_KEY } from './tenant.guard';

export const Public = () => SetMetadata(SKIP_TENANT_KEY, true);
