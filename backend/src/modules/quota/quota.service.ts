import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

export interface QuotaStatus {
  used: number;
  limit: number | null; // null = unlimited
  remaining: number | null;
  monthBucket: string;
}

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  status: QuotaStatus;
}

/**
 * QuotaService — enforce per-organization monthly token quotas.
 *
 * - The plan's `limits.monthlyTokens` is the hard cap.
 * - Current usage is summed from `usage_records.month_bucket`.
 * - The check is cached in Redis for 30s to avoid hammering Postgres on hot paths.
 */
@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);
  private readonly CACHE_TTL = 30; // seconds

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Returns the current month's usage status for an organization. */
  async getStatus(organizationId: string): Promise<QuotaStatus> {
    const monthBucket = this.currentMonth();
    const cacheKey = `quota:${organizationId}:${monthBucket}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch { /* ignore */ }
    }

    const [agg, sub] = await Promise.all([
      this.prisma.usageRecord.aggregate({
        where: { organizationId, monthBucket },
        _sum: { totalTokens: true },
      }),
      this.prisma.subscription.findUnique({
        where: { organizationId },
        include: { plan: true },
      }),
    ]);

    const used = agg._sum?.totalTokens ?? 0;
    const limit = (sub?.plan?.limits as any)?.monthlyTokens ?? null;
    const remaining = limit == null ? null : Math.max(0, limit - used);
    const status: QuotaStatus = { used, limit, remaining, monthBucket };
    await this.redis.set(cacheKey, JSON.stringify(status), this.CACHE_TTL);
    return status;
  }

  /**
   * Check if `estimatedTokens` more tokens can be consumed.
   * Throws if the quota is exceeded.
   */
  async enforce(organizationId: string, estimatedTokens: number): Promise<QuotaCheckResult> {
    const status = await this.getStatus(organizationId);
    if (status.limit == null) {
      return { allowed: true, status };
    }
    if (status.used + estimatedTokens > status.limit) {
      return {
        allowed: false,
        reason: `Monthly quota exceeded: ${status.used}/${status.limit} tokens used`,
        status,
      };
    }
    return { allowed: true, status };
  }

  /** Invalidate the cached status (call after recording usage). */
  async invalidate(organizationId: string): Promise<void> {
    await this.redis.del(`quota:${organizationId}:${this.currentMonth()}`);
  }

  private currentMonth(): string {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
}
