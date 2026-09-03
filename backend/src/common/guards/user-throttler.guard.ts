import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

/**
 * Per-user throttling: when a JWT is present we throttle by `userId + orgId`
 * (so a single user can't bypass by switching org). Otherwise we fall back
 * to the IP-based key.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected generateKey(context: ExecutionContext, suffix: string, name: string): string {
    const req = context.switchToHttp().getRequest();
    const tracker = this.getTrackerSync(req);
    return `${name}-${tracker}-${suffix}`;
  }

  private getTrackerSync(req: Record<string, any>): string {
    const user = req?.user;
    if (user?.sub && user?.organizationId) {
      return `u:${user.sub}:${user.organizationId}`;
    }
    return req?.ip ?? 'unknown';
  }

  protected async throwThrottlingException(_ctx: ExecutionContext, _detail: ThrottlerLimitDetail): Promise<void> {
    throw new (await import('@nestjs/common')).HttpException(
      { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
      429,
    );
  }
}
