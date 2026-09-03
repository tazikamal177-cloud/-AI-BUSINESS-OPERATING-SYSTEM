import { Injectable, Logger } from '@nestjs/common';
import { AiGatewayService } from '../ai/gateway/ai-gateway.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface RetrievedChunk {
  id: string;
  content: string;
  metadata: any;
  documentId: string;
  documentName: string;
  distance: number;
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly gateway: AiGatewayService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Retrieve the top-K most relevant chunks across the agent's knowledge bases.
   * The full ingestion pipeline (PDF/DOCX/CSV → chunks → embeddings) is implemented
   * in Phase 6. This Phase 4 implementation expects chunks to already be in DB.
   */
  async retrieve(opts: {
    organizationId: string;
    knowledgeBaseIds: string[];
    query: string;
    topK?: number;
  }): Promise<RetrievedChunk[]> {
    const k = opts.topK ?? 5;
    if (!opts.knowledgeBaseIds.length) return [];

    const embedding = await this.gateway.embed(opts.query, 'openai', 'text-embedding-3-small');

    // pgvector cosine distance; RLS scopes to current org automatically.
    const rows: any[] = await this.prisma.$queryRaw`
      SELECT
        dc.id,
        dc.content,
        dc.metadata,
        dc.document_id   AS "documentId",
        d.original_name  AS "documentName",
        (dc.embedding <=> ${embedding as any}) AS distance
      FROM document_chunks dc
      JOIN documents d ON d.id = dc.document_id
      WHERE d.organization_id = ${opts.organizationId}
        AND d.knowledge_base_id = ANY (${opts.knowledgeBaseIds}::uuid[])
        AND d.deleted_at IS NULL
      ORDER BY distance ASC
      LIMIT ${k}
    `;

    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      metadata: r.metadata,
      documentId: r.documentId,
      documentName: r.documentName,
      distance: parseFloat(r.distance),
    }));
  }

  /** Build the "## Knowledge" section that gets injected into the system prompt. */
  buildContext(chunks: RetrievedChunk[]): string {
    if (!chunks.length) return '';
    const blocks = chunks
      .map(
        (c, i) =>
          `[#${i + 1} — ${c.documentName}]\n${c.content}`,
      )
      .join('\n\n---\n\n');
    return `\n\n## Knowledge\nThe following excerpts from the organization's knowledge base are relevant to the user's question. Use them to ground your answer, and cite the document name when you do.\n\n${blocks}\n`;
  }
}
