# Système de Tenancy — AIBOS

> **Apprentissage clé** : transformer une règle de sécurité multi-tenant (chaque requête doit être scopée à une organisation) en code **typé et explicite**, où le compilateur t'empêche de faire une requête sans tenant.

## Le problème résolu

Avant, chaque controller faisait :
```typescript
@Get(':id')
async findOne(@Param('id') id: string, @Req() req: any) {
  return this.service.findOne(req.organizationId, id);
}
```

**Problèmes** :
- `req.organizationId` est une magic string. Si on l'oublie, fuite.
- Le compilateur ne dit rien. La sécurité n'est pas dans le type.
- Réutilisable tel quel = réutilisable mal.

Maintenant, chaque controller fait :
```typescript
@Get(':id')
@UseGuards(TenantGuard)
async findOne(
  @Param('id') id: string,
  @CurrentTenant() tenant: TenantContext,
) {
  return this.service.findById(tenant, id);
}
```

**Avantages** :
- `TenantContext` est typé. Le compilateur sait ce qu'il y a dedans.
- `tenant` est immutable (Object.freeze). Personne ne peut le modifier.
- Si tu oublies `@UseGuards(TenantGuard)`, le `TenantGuard` global au niveau app te bloque.
- Si tu oublies de passer `tenant` à un repository, le type t'aide à voir que la signature l'attend.

## Architecture en 3 couches

```
HTTP Request
   │
   ├── JwtAuthGuard         → vérifie le token, pose req.user
   │
   ├── TenantGuard          → vérifie la membership DB,
   │                          construit TenantContext,
   │                          pose req.tenantContext
   │
   ├── RolesGuard           → vérifie le rôle (optionnel)
   │
   ├── PermissionsGuard     → vérifie les permissions fines (optionnel)
   │
   └── Controller
        │
        └── Service / Repository
             │  (reçoit TenantContext en paramètre)
             │
             └── Prisma
                  WHERE organization_id = tenant.organizationId  (implicite)
```

## Fichiers créés

```
src/shared/tenant/
├── tenant-context.ts           # Classe immutable + types Permission
├── permission.service.ts       # Matrice rôle → permissions
├── tenant.guard.ts             # Résout et attache le TenantContext
├── roles.guard.ts              # Vérifie les rôles
├── permissions.guard.ts        # Vérifie les permissions fines
├── current-tenant.decorator.ts # @CurrentTenant()
├── public.decorator.ts         # @Public() — bypass le guard
├── roles.decorator.ts          # @Roles(...)
├── permissions.decorator.ts    # @Permissions(...)
├── tenant.module.ts            # Module NestJS global
├── index.ts                    # Barrel export
└── tenant.spec.ts              # 22 tests unitaires
```

## Utilisation

### Sur un endpoint basique

```typescript
@UseGuards(TenantGuard)
@Get()
async findAll(@CurrentTenant() tenant: TenantContext) {
  return this.agentService.findAll(tenant);
}
```

### Sur un endpoint avec restriction de rôle

```typescript
@UseGuards(TenantGuard, RolesGuard)
@Roles(MemberRole.OWNER, MemberRole.ADMIN)
@Delete(':id')
async delete(@Param('id') id: string, @CurrentTenant() tenant: TenantContext) {
  return this.agentService.delete(tenant, id);
}
```

### Sur un endpoint avec permission fine

```typescript
@UseGuards(TenantGuard, PermissionsGuard)
@Permissions('billing:write')
@Post('subscribe')
async subscribe(@Body() dto: SubscribeDto, @CurrentTenant() tenant: TenantContext) {
  return this.billingService.subscribe(tenant, dto);
}
```

### Sur un endpoint public (health check, webhook)

```typescript
@Public()
@Get('health')
health() {
  return { status: 'ok' };
}
```

## Côté service / repository

```typescript
@Injectable()
export class AgentService {
  async findAll(tenant: TenantContext): Promise<Agent[]> {
    return this.prisma.agent.findMany({
      where: { organizationId: tenant.organizationId },
    });
  }

  async delete(tenant: TenantContext, id: string): Promise<void> {
    // Le repository throw si l'agent n'appartient pas au tenant
    const agent = await this.prisma.agent.findFirst({
      where: { id, organizationId: tenant.organizationId },
    });
    if (!agent) throw new NotFoundException('Agent not found');

    await this.prisma.agent.delete({ where: { id } });
  }
}
```

## Matrice de permissions

| Rôle | Lecture | Création | Suppression | Billing | Membres |
|---|---|---|---|---|---|
| **OWNER** | Tout | Tout | Tout | R/W | Invite, remove, update role |
| **ADMIN** | Tout | Tout | Tout sauf billing | R | Invite, remove |
| **MANAGER** | Tout | Agents, KB, workflows | Pas de delete | R | Non |
| **OPERATOR** | Lecture | Conversations | Non | Non | Non |
| **VIEWER** | Lecture | Non | Non | Non | Non |

Voir `permission.service.ts` pour la matrice exacte.

## Tests

22 tests unitaires couvrent :
- Immutabilité du TenantContext
- Validation des champs requis
- Méthodes `hasRole`, `hasPermission`, `requirePermission`
- Résolution correcte des permissions par rôle
- Hiérarchie des rôles (OWNER a plus de perms que VIEWER)

```bash
npm test src/shared/tenant
```

## Prochaines étapes (pas dans cette session)

1. Activer le `TenantGuard` en **global guard** (APP_GUARD) pour qu'aucun endpoint ne puisse l'oublier
2. Refactorer tous les controllers existants pour utiliser `@CurrentTenant()`
3. Écrire les tests d'intrusion inter-tenant (E2E)
4. Activer RLS PostgreSQL comme niveau 3 de défense
5. Ajouter throttling différencié par plan
