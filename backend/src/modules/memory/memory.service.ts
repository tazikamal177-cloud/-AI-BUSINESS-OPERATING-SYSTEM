import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { MemoryType } from '@prisma/client';

const SHORT_TERM_TTL_SEC = 30 * 60; // 30 min sliding

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Short-term (Redis) memory: the last messages of a conversation.
   * TTL resets on each call → sliding window.
   */
  async pushShortTerm(conversationId: string, role: 'user' | 'assistant', content: string): Promise<void> {
    const key = `mem:st:${conversationId}`;
    const entry = JSON.stringify({ role, content, ts: Date.now() });
    await this.redis.getClient().rpush(key, entry);
    await this.redis.getClient().ltrim(key, -50, -1); // keep last 50
    await this.redis.expire(key, SHORT_TERM_TTL_SEC);
  }

  async getShortTerm(conversationId: string): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const key = `mem:st:${conversationId}`;
    const items = await this.redis.getClient().lrange(key, 0, -1);
    return items.map((s) => {
      try { return JSON.parse(s); } catch { return { role: 'user' as const, content: s }; }
    });
  }

  /**
   * Long-term memory: persistent facts about a user, with embeddings.
   * Embeddings are stored via raw SQL because pgvector's `vector` type is
   * not representable in Prisma's generated client.
   */
  async addLongTerm(opts: {
    organizationId: string;
    userId: string;
    content: string;
    embedding?: number[];
    importance?: number;
    metadata?: Record<string, unknown>;
  }) {
    const created = await this.prisma.memory.create({
      data: {
        organizationId: opts.organizationId,
        userId: opts.userId,
        type: MemoryType.LONG_TERM,
        content: opts.content,
        importance: opts.importance ?? 0.5,
        metadata: opts.metadata as any,
      },
    });
    if (opts.embedding) {
      await this.updateEmbedding(created.id, opts.embedding);
    }
    return created;
  }

  async addBusiness(opts: {
    organizationId: string;
    content: string;
    embedding?: number[];
    importance?: number;
    metadata?: Record<string, unknown>;
  }) {
    const created = await this.prisma.memory.create({
      data: {
        organizationId: opts.organizationId,
        type: MemoryType.BUSINESS,
        content: opts.content,
        importance: opts.importance ?? 0.5,
        metadata: opts.metadata as any,
      },
    });
    if (opts.embedding) {
      await this.updateEmbedding(created.id, opts.embedding);
    }
    return created;
  }

  private async updateEmbedding(id: string, embedding: number[]) {
    const vector = `[${embedding.join(',')}]`;
    await this.prisma.$executeRawUnsafe(
      `UPDATE memories SET embedding = $1::vector WHERE id = $2`,
      [vector, id],
    );
  }

  async searchLongTerm(opts: {
    organizationId: string;
    userId: string;
    embedding: number[];
    topK?: number;
  }): Promise<Array<{ id: string; content: string; importance: number }>> {
    const k = opts.topK ?? 5;
    const rows: any[] = await this.prisma.$queryRaw`
      SELECT id, content, importance,
             embedding <=> ${opts.embedding as any} AS distance
        FROM memories
       WHERE organization_id = ${opts.organizationId}
         AND user_id = ${opts.userId}
         AND type = 'LONG_TERM'
       ORDER BY distance ASC
       LIMIT ${k}
    `;
    return rows;
  }
}
