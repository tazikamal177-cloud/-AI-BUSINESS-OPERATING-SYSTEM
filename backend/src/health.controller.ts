import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';
import { StorageService } from './modules/storage/storage.service';
import { AiGatewayService } from './modules/ai/gateway/ai-gateway.service';

@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly ai: AiGatewayService,
  ) {}

  /**
   * Liveness — process is up. Cheap. No dependency checks.
   *
   * Mounted at /api/health (prefix 'api' applied, version neutral).
   * This URL is what the Docker HEALTHCHECK probes.
   */
  @Get()
  liveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /**
   * Readiness — DB + Redis + S3 + AI providers reachable.
   * Mounted at /api/health/ready.
   */
  @Get('ready')
  async readiness() {
    const checks: Record<string, { ok: boolean; error?: string; latencyMs?: number }> = {};

    const timed = async (key: string, fn: () => Promise<void>) => {
      const start = Date.now();
      try { await fn(); checks[key] = { ok: true, latencyMs: Date.now() - start }; }
      catch (e) { checks[key] = { ok: false, error: (e as Error).message, latencyMs: Date.now() - start }; }
    };

    await timed('postgres', async () => {
      await this.prisma.$queryRaw`SELECT 1`;
    });
    await timed('redis', async () => {
      const r = await this.redis.getClient().ping();
      if (r !== 'PONG') throw new Error(`Redis ping returned ${r}`);
    });
    await timed('storage', async () => {
      // A cheap way: presign a key then do a HEAD on it.
      const url = await this.storage.presignGet('.aibos-health-probe', 30).catch(() => null);
      if (!url) return; // no S3 configured → soft-skip
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      // 403/404 are fine; 5xx is not.
      if (res.status >= 500) throw new Error(`S3 returned ${res.status}`);
    });
    await timed('ai', async () => {
      // Cheap probe: list models.
      const models = this.ai.list();
      if (!models.length) throw new Error('No AI providers registered');
    });

    const ok = Object.values(checks).every((c) => c.ok);
    return {
      status: ok ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}
