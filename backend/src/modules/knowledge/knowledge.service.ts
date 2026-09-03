import { Injectable, Logger, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AiGatewayService } from '../ai/gateway/ai-gateway.service';
import { StorageService } from '../storage/storage.service';
import { TextChunker } from './chunker/text-chunker';
import {
  CsvExtractor,
  DocxExtractor,
  HtmlExtractor,
  PdfExtractor,
  TextExtractor,
  UrlExtractor,
} from './extractors/extractors';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import { AuditService } from '../audit/audit.service';
import { RagService } from './rag.service';

const EMBED_BATCH = 16; // OpenAI limit per request

export interface UploadInput {
  organizationId: string;
  userId: string;
  knowledgeBaseId: string;
  buffer?: Buffer;
  filename: string;
  mimeType: string;
  /** Optional URL to fetch instead of receiving a buffer (e.g. webpage ingestion) */
  url?: string;
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiGatewayService,
    private readonly storage: StorageService,
    private readonly chunker: TextChunker,
    private readonly pdf: PdfExtractor,
    private readonly docx: DocxExtractor,
    private readonly text: TextExtractor,
    private readonly csv: CsvExtractor,
    private readonly html: HtmlExtractor,
    private readonly url: UrlExtractor,
    private readonly audit: AuditService,
    private readonly rag: RagService,
    private readonly config: ConfigService,
  ) {}

  // ──────────────────────────── Knowledge Bases ────────────────────────────

  async listBases(orgId: string) {
    return this.prisma.knowledgeBase.findMany({
      where: { organizationId: orgId, deletedAt: null },
      include: {
        _count: { select: { documents: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getBase(orgId: string, kbId: string) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: kbId, organizationId: orgId, deletedAt: null },
      include: {
        documents: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            filename: true,
            originalName: true,
            fileType: true,
            fileSize: true,
            status: true,
            processedAt: true,
            error: true,
            createdAt: true,
            metadata: true,
          },
        },
        _count: { select: { documents: true } },
      },
    });
    if (!kb) throw new NotFoundException('Knowledge base not found');
    // Aggregate chunk count
    const agg = await this.prisma.documentChunk.aggregate({
      where: { knowledgeBaseId: kbId, document: { organizationId: orgId, deletedAt: null } } as any,
      _count: { _all: true },
    });
    return { ...kb, _count: { ...kb._count, chunks: agg._count._all } };
  }

  async createBase(orgId: string, dto: CreateKnowledgeBaseDto) {
    return this.prisma.knowledgeBase.create({
      data: {
        organizationId: orgId,
        name: dto.name,
        description: dto.description,
        embeddingModel: dto.embeddingModel ?? 'text-embedding-3-small',
        chunkSize: dto.chunkSize ?? 800,
        chunkOverlap: dto.chunkOverlap ?? 200,
      },
    });
  }

  async updateBase(orgId: string, kbId: string, dto: { name?: string; description?: string; chunkSize?: number; chunkOverlap?: number }) {
    const kb = await this.prisma.knowledgeBase.findFirst({ where: { id: kbId, organizationId: orgId, deletedAt: null } });
    if (!kb) throw new NotFoundException('Knowledge base not found');
    return this.prisma.knowledgeBase.update({
      where: { id: kbId },
      data: {
        name: dto.name,
        description: dto.description,
        chunkSize: dto.chunkSize,
        chunkOverlap: dto.chunkOverlap,
      },
    });
  }

  async archiveBase(orgId: string, kbId: string) {
    const kb = await this.prisma.knowledgeBase.findFirst({ where: { id: kbId, organizationId: orgId, deletedAt: null } });
    if (!kb) throw new NotFoundException('Knowledge base not found');
    await this.prisma.$transaction([
      this.prisma.knowledgeBase.update({ where: { id: kbId }, data: { deletedAt: new Date() } }),
      this.prisma.document.updateMany({ where: { knowledgeBaseId: kbId }, data: { deletedAt: new Date() } }),
    ]);
    return { message: 'Knowledge base archived' };
  }

  // ──────────────────────────── Documents ────────────────────────────

  async listDocuments(orgId: string, kbId: string) {
    const kb = await this.prisma.knowledgeBase.findFirst({ where: { id: kbId, organizationId: orgId, deletedAt: null } });
    if (!kb) throw new NotFoundException('Knowledge base not found');
    return this.prisma.document.findMany({
      where: { knowledgeBaseId: kbId, organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        filename: true,
        originalName: true,
        fileType: true,
        fileSize: true,
        status: true,
        processedAt: true,
        error: true,
        createdAt: true,
      },
    });
  }

  /**
   * Upload a document: store the raw file in S3, create a `documents` row in
   * `PENDING`, then trigger ingestion. If `url` is provided, we fetch it
   * instead of using a buffer.
   *
   * Ingestion is performed inline for small files (< 1 MB) and enqueued to
   * BullMQ for larger ones. (BullMQ is optional — falls back to inline if not
   * configured, see `enqueueIngestion`.)
   */
  async uploadDocument(input: UploadInput) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: input.knowledgeBaseId, organizationId: input.organizationId, deletedAt: null },
    });
    if (!kb) throw new NotFoundException('Knowledge base not found');

    // 1. Upload raw to S3 (or fetch URL → buffer → upload)
    let buffer = input.buffer;
    let filename = input.filename;
    if (input.url) {
      const r = await fetch(input.url);
      if (!r.ok) throw new BadRequestException(`Failed to fetch URL: ${r.status}`);
      buffer = Buffer.from(await r.arrayBuffer());
      filename = input.url.split('/').pop()?.split('?')[0] || 'webpage';
    }
    if (!buffer) throw new BadRequestException('Either buffer or url is required');

    // 2. Upload to S3
    const stored = await this.storage.upload({
      organizationId: input.organizationId,
      buffer,
      contentType: input.mimeType,
      originalName: filename,
      prefix: 'knowledge',
    });

    // 3. Create document row
    const doc = await this.prisma.document.create({
      data: {
        id: randomUUID(),
        knowledgeBaseId: kb.id,
        organizationId: input.organizationId,
        filename: stored.key,
        originalName: filename,
        fileType: this.extensionOf(filename),
        fileSize: stored.size,
        fileUrl: stored.url,
        mimeType: input.mimeType,
        status: 'PENDING',
        uploadedBy: input.userId,
      },
    });

    await this.audit.log({
      organizationId: input.organizationId,
      userId: input.userId,
      action: 'document.upload',
      resourceType: 'document',
      resourceId: doc.id,
      metadata: { knowledgeBaseId: kb.id, filename, size: stored.size },
    });

    // 4. Trigger ingestion (inline or queued)
    if (buffer.length < 1024 * 1024) {
      // Small file: process inline
      this.ingestDocument(doc.id, kb.id, input.organizationId).catch((e) =>
        this.logger.error(`Inline ingestion failed for ${doc.id}: ${(e as Error).message}`),
      );
    } else {
      // Large file: enqueue (BullMQ optional)
      await this.enqueueIngestion(doc.id, kb.id, input.organizationId);
    }

    return doc;
  }

  async reindexDocument(orgId: string, docId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: docId, organizationId: orgId, deletedAt: null },
      include: { knowledgeBase: true },
    });
    if (!doc) throw new NotFoundException('Document not found');
    if (!doc.knowledgeBase) throw new BadRequestException('Document has no knowledge base');

    // Delete old chunks
    await this.prisma.documentChunk.deleteMany({ where: { documentId: docId } });
    // Re-trigger
    await this.prisma.document.update({
      where: { id: docId },
      data: { status: 'PENDING', error: null, processedAt: null },
    });
    await this.ingestDocument(docId, doc.knowledgeBaseId, orgId);
    return { message: 'Reindex started' };
  }

  async deleteDocument(orgId: string, docId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: docId, organizationId: orgId, deletedAt: null },
    });
    if (!doc) throw new NotFoundException('Document not found');
    // Soft-delete + remove chunks
    await this.prisma.$transaction([
      this.prisma.documentChunk.deleteMany({ where: { documentId: docId } }),
      this.prisma.document.update({ where: { id: docId }, data: { deletedAt: new Date() } }),
    ]);
    // Try to remove from S3 (best-effort)
    try { await this.storage.delete(doc.filename); } catch { /* ignore */ }
    await this.audit.log({
      organizationId: orgId,
      action: 'document.delete',
      resourceType: 'document',
      resourceId: docId,
    });
    return { message: 'Document deleted' };
  }

  // ──────────────────────────── Search (debug) ────────────────────────────

  async debugSearch(orgId: string, kbId: string, query: string, topK = 5) {
    const kb = await this.prisma.knowledgeBase.findFirst({ where: { id: kbId, organizationId: orgId, deletedAt: null } });
    if (!kb) throw new NotFoundException('Knowledge base not found');
    const chunks = await this.rag.retrieve({
      organizationId: orgId,
      knowledgeBaseIds: [kbId],
      query,
      topK,
    });
    return { query, knowledgeBaseId: kbId, chunks };
  }

  // ──────────────────────────── Ingestion pipeline ────────────────────────────

  /**
   * Public entry point for the BullMQ worker. Idempotent: if status is not
   * PENDING, it is a no-op. PROCESSING means another worker is on it
   * (best-effort: we skip to avoid double-insert under BullMQ retries).
   */
  async ingestDocument(documentId: string, knowledgeBaseId: string, organizationId: string) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) return;
    // Idempotence guard: skip if already completed OR already in flight
    if (doc.status === 'COMPLETED' || doc.status === 'PROCESSING') {
      this.logger.log(`ingestDocument(${documentId}) skipped — status=${doc.status}`);
      return;
    }
    const kb = await this.prisma.knowledgeBase.findUnique({ where: { id: knowledgeBaseId } });
    if (!kb) return;

    try {
      await this.prisma.document.update({ where: { id: documentId }, data: { status: 'PROCESSING' } });

      // 1. Fetch raw file from S3
      const buffer = await this.downloadFromStorage(doc.fileUrl);
      // 2. Extract text
      const { text, metadata } = await this.extractText(buffer, doc.mimeType, doc.originalName);
      if (!text || !text.trim()) {
        throw new BadRequestException('No extractable text found in document');
      }
      // 3. Chunk
      const chunkSize = kb.chunkSize ?? 800;
      const chunkOverlap = kb.chunkOverlap ?? 200;
      const pieces = this.chunker.split(text, chunkSize, chunkOverlap);
      // 4. Embed in batches
      for (let i = 0; i < pieces.length; i += EMBED_BATCH) {
        const batch = pieces.slice(i, i + EMBED_BATCH);
        const embeddings = await this.ai.embedBatch(batch, 'openai', kb.embeddingModel ?? 'text-embedding-3-small');
        // 5. Insert chunks
        for (let j = 0; j < batch.length; j++) {
          await this.insertChunk(documentId, organizationId, i + j, batch[j], embeddings[j], metadata);
        }
      }

      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'COMPLETED', processedAt: new Date(), error: null },
      });
      await this.audit.log({
        organizationId,
        action: 'document.ingested',
        resourceType: 'document',
        resourceId: documentId,
        metadata: { chunks: pieces.length, knowledgeBaseId },
      });
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.error(`Ingestion failed for ${documentId}: ${msg}`);
      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: 'FAILED', error: msg.slice(0, 1000) },
      });
      await this.audit.log({
        organizationId,
        action: 'document.ingestion_failed',
        resourceType: 'document',
        resourceId: documentId,
        metadata: { error: msg },
        result: 'FAILURE',
      });
    }
  }

  // ──────────────────────────── helpers ────────────────────────────

  private async extractText(buffer: Buffer, mimeType: string, filename: string) {
    const ctx = { buffer, filename, mimeType };
    for (const ex of [this.pdf, this.docx, this.html, this.csv, this.text]) {
      if (ex.supports(ctx)) return ex.extract(ctx);
    }
    throw new BadRequestException(`Unsupported file type: ${mimeType} (${filename})`);
  }

  private async insertChunk(
    documentId: string,
    organizationId: string,
    index: number,
    content: string,
    embedding: number[],
    docMetadata: any,
  ) {
    const tokenCount = this.chunker.countTokens(content);
    // Insert via raw SQL because pgvector's `vector` is not representable in the Prisma client
    const vector = `[${embedding.join(',')}]`;
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO document_chunks (id, document_id, organization_id, content, chunk_index, token_count, metadata, embedding, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, now())`,
      [randomUUID(), documentId, organizationId, content, index, tokenCount, JSON.stringify(docMetadata ?? {}), vector],
    );
  }

  /**
   * Download the raw file. We expect a presigned URL or the s3:// scheme.
   * For s3:// urls we generate a presigned GET on the fly.
   */
  private async downloadFromStorage(fileUrl: string): Promise<Buffer> {
    if (fileUrl.startsWith('s3://')) {
      const key = fileUrl.replace(/^s3:\/\/[^/]+\//, '');
      const presigned = await this.storage.presignGet(key, 300);
      return this.downloadFromStorage(presigned);
    }
    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  private extensionOf(filename: string): string {
    const m = /\.([a-z0-9]+)$/i.exec(filename);
    return m ? m[1].toLowerCase() : 'bin';
  }

  /**
   * Enqueue ingestion. If BullMQ is configured, the worker picks it up.
   * If not, we process inline (synchronous, blocks the request).
   */
  private async enqueueIngestion(documentId: string, kbId: string, orgId: string) {
    // BullMQ is wired in Phase 7+. For now, process inline (best-effort).
    return this.ingestDocument(documentId, kbId, orgId);
  }
}
