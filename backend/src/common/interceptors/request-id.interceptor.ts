import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';

/**
 * Adds a request-id to every request, propagated via:
 *  - `X-Request-Id` response header
 *  - `request.requestId` on the Express request
 *  - AsyncLocalStorage (TenantContext will reuse this in Phase 3+)
 *
 * Also logs duration for every request.
 */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { requestId?: string }>();
    const res = http.getResponse<Response>();

    const incoming = (req.headers['x-request-id'] as string | undefined)?.slice(0, 64);
    const id = incoming && /^[a-zA-Z0-9._-]+$/.test(incoming) ? incoming : randomUUID();
    req.requestId = id;
    res.setHeader('X-Request-Id', id);

    const start = Date.now();
    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - start;
          this.logger.log(`[${id}] ${req.method} ${req.url} → ${res.statusCode} ${ms}ms`);
        },
        error: () => {
          const ms = Date.now() - start;
          this.logger.warn(`[${id}] ${req.method} ${req.url} → ERR ${ms}ms`);
        },
      }),
    );
  }
}
