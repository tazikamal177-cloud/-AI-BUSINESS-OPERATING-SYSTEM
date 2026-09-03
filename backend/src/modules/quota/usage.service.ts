import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { TokenUsage } from '../ai/types/provider.types';

export interface RecordUsageInput {
  organizationId: string;
  userId?: string;
  agentId?: string;
  agentVersionId?: string;
  conversationId?: string;
  messageId?: string;
  modelProvider: string;
  modelName: string;
  usage: TokenUsage;
  operation: 'agent_execution' | 'agent_test' | 'embedding' | 'workflow_run';
  metadata?: Record<string, unknown>;
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
  ) {}

  /**
   * Record a usage event. Append-only. Invalidates the per-org quota cache.
   */
  async record(input: RecordUsageInput): Promise<void> {
    const monthBucket = this.currentMonth();
    try {
      await this.prisma.usageRecord.create({
        data: {
          id: randomUUID(),
          organizationId: input.organizationId,
          userId: input.userId,
          agentId: input.agentId,
          agentVersionId: input.agentVersionId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          modelProvider: input.modelProvider,
          modelName: input.modelName,
          inputTokens: input.usage.inputTokens,
          outputTokens: input.usage.outputTokens,
          totalTokens: input.usage.totalTokens,
          estimatedCost: input.usage.estimatedCostUsd,
          operation: input.operation,
          monthBucket,
          metadata: input.metadata as any,
        },
      });
      // Invalidate cached quota
      await this.quota.invalidate(input.organizationId);
    } catch (e) {
      // Usage tracking must never break a request — log and continue.
      this.logger.error(`Failed to record usage: ${(e as Error).message}`);
    }
  }

  private currentMonth(): string {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
}
