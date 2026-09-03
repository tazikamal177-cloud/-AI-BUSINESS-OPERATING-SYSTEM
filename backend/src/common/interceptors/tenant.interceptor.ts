import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, switchMap } from 'rxjs';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { TENANT_CONTEXT_KEY, TenantContext } from '../../shared/tenant/tenant.guard';

/**
 * TenantInterceptor — binds the Postgres session GUCs (`app.current_user_id`,
 * `app.current_org_id`, `app.is_service`) for the duration of the request,
 * so that RLS policies apply to every Prisma query issued downstream.
 *
 * Must run AFTER TenantGuard (which attaches TenantContext on the request).
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { tenantContext?: TenantContext }>();
    const tenant: TenantContext | undefined = req[TENANT_CONTEXT_KEY];

    // No tenant context → either public route or guard skipped: bypass binding.
    if (!tenant) {
      return next.handle();
    }

    return from(
      this.prisma.runWithTenant(
        {
          organizationId: tenant.organizationId,
          userId: tenant.userId,
          isService: false,
        },
        async () => undefined,
      ),
    ).pipe(switchMap(() => next.handle()));
  }
}
