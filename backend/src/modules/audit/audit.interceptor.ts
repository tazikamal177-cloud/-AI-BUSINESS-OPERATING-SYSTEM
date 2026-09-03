import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';
import { AuditService } from './audit.service';
import { AUDIT_KEY, AuditMeta } from './audit.decorator';
import { TENANT_CONTEXT_KEY, TenantContext } from '../../shared/tenant/tenant.guard';

/**
 * Audits the action declared via @Audit({...}) on success.
 * On error: logs a WARN with the error and does NOT write to audit_logs
 * (the error filter handles 4xx/5xx responses).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMeta>(AUDIT_KEY, context.getHandler());
    if (!meta) return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { tenantContext?: TenantContext }>();
    const tenant = req[TENANT_CONTEXT_KEY];

    return next.handle().pipe(
      tap(async (responseBody: any) => {
        if (!tenant) return;
        try {
          const resourceId = meta.resourceIdFrom
            ? this.extractPath(responseBody, meta.resourceIdFrom)
            : undefined;
          await this.audit.log({
            organizationId: tenant.organizationId,
            userId: tenant.userId,
            action: meta.action,
            resourceType: meta.resourceType,
            resourceId,
            metadata: { path: req.url, method: req.method },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] as string | undefined,
            result: 'SUCCESS',
          });
        } catch (e) {
          this.logger.error(
            `Failed to write audit log for action=${meta.action}: ${(e as Error).message}`,
          );
        }
      }),
    );
  }

  private extractPath(obj: unknown, path: string): string | undefined {
    try {
      const parts = path.split('.');
      let cur: any = obj;
      for (const p of parts) {
        if (cur == null) return undefined;
        cur = cur[p];
      }
      return cur == null ? undefined : String(cur);
    } catch {
      return undefined;
    }
  }
}
