/**
 * Knowledge — ingestion idempotence tests.
 *
 * Test-first protocol (CRITIQUE 6):
 *   - Tests observe the current behavior of ingestDocument.
 *   - If a test FAILS, the behavior is unexpected and we document it
 *     as a NEW CRITIQUE (we do NOT silently fix the service here).
 *   - We do not modify the service from this file.
 *
 * Targets:
 *   1. ingestDocument(PENDING) → status=COMPLETED, chunks inserted
 *   2. ingestDocument(COMPLETED) — observed behavior (idempotent or not?)
 *   3. ingestDocument on a missing document → no-op (no chunks)
 *   4. ingestDocument when extraction throws → status=FAILED
 *   5. ingestDocument on a missing KB → no-op
 *
 * CRITIQUE 6 finding: the source comment claims idempotence, but the
 * code path does not enforce it. Test 2 will reveal this.
 */
import { BadRequestException } from '@nestjs/common';
import { KnowledgeService } from '../knowledge.service';

class FakePrisma {
  private _documents = new Map<string, any>();
  private _knowledgeBases = new Map<string, any>();
  private _chunkInserts: any[] = [];
  private _docUpdates: any[] = [];

  document = {
    findUnique: jest.fn(async ({ where: { id } }: any) => {
      const d = this._documents.get(id);
      return d ? { ...d } : null;
    }),
    update: jest.fn(async ({ where: { id }, data }: any) => {
      this._docUpdates.push({ id, data });
      const d = this._documents.get(id);
      if (d) Object.assign(d, data);
      return d ? { ...d } : null;
    }),
  };

  knowledgeBase = {
    findUnique: jest.fn(async ({ where: { id } }: any) => {
      const kb = this._knowledgeBases.get(id);
      return kb ? { ...kb } : null;
    }),
  };

  $executeRawUnsafe = jest.fn(async (sql: string, params: any[]) => {
    if (sql.startsWith('INSERT INTO document_chunks')) {
      this._chunkInserts.push({ sql, params });
    }
    return 1;
  });

  // helpers
  seedDoc(id: string, overrides: any = {}) {
    this._documents.set(id, {
      id, fileUrl: 'http://example.test/file.txt',
      mimeType: 'text/plain', originalName: 'file.txt',
      status: 'PENDING', error: null, knowledgeBaseId: 'kb-1',
      ...overrides,
    });
  }
  seedKb(id: string, overrides: any = {}) {
    this._knowledgeBases.set(id, { id, organizationId: 'org-1', chunkSize: 800, chunkOverlap: 200, embeddingModel: 'text-embedding-3-small', ...overrides });
  }
  chunkInsertCount() { return this._chunkInserts.length; }
}

class FakeAi { embedBatch = jest.fn(async (batch: string[]) => batch.map(() => new Array(8).fill(0.1))); }
class FakeStorage { presignGet = jest.fn(async (key: string) => 'http://example.test/' + key); }
class FakeChunker {
  split = jest.fn((text: string) => [text]);
  countTokens = jest.fn(() => 10);
}
class FakeTextExtractor { supports = () => true; extract = async () => ({ text: 'hello world', metadata: {} }); }
class FakePdfExtractor { supports = () => false; extract = async () => ({ text: '', metadata: {} }); }
class FakeDocxExtractor { supports = () => false; extract = async () => ({ text: '', metadata: {} }); }
class FakeCsvExtractor { supports = () => false; extract = async () => ({ text: '', metadata: {} }); }
class FakeHtmlExtractor { supports = () => false; extract = async () => ({ text: '', metadata: {} }); }
class FakeUrlExtractor { supports = () => false; extract = async () => ({ text: '', metadata: {} }); }
class FakeAudit { log = jest.fn(async () => undefined); }
class FakeRag { /* unused here */ }
class FakeConfig { get = jest.fn((k: string) => undefined); }

function makeService(overrides: any = {}) {
  const prisma = overrides.prisma ?? new FakePrisma();
  const ai = new FakeAi();
  const storage = new FakeStorage();
  const chunker = new FakeChunker();
  const pdf = overrides.pdf ?? new FakePdfExtractor();
  const docx = overrides.docx ?? new FakeDocxExtractor();
  const text = overrides.text ?? new FakeTextExtractor();
  const csv = new FakeCsvExtractor();
  const html = new FakeHtmlExtractor();
  const url = new FakeUrlExtractor();
  const audit = new FakeAudit();
  const rag = new FakeRag();
  const config = new FakeConfig();
  const svc = new KnowledgeService(
    prisma as any, ai as any, storage as any, chunker as any,
    pdf as any, docx as any, text as any, csv as any, html as any, url as any,
    audit as any, rag as any, config as any,
  );
  return { svc, prisma, ai, storage, chunker, text, pdf, audit, config };
}

describe('KnowledgeService.ingestDocument — idempotence', () => {
  it('1. PENDING document → COMPLETED + chunks inserted', async () => {
    const { svc, prisma } = makeService();
    prisma.seedKb('kb-1');
    prisma.seedDoc('d-1', { status: 'PENDING' });
    // Stub fetch to return a tiny buffer (downloadFromStorage uses global fetch)
    const originalFetch = (global as any).fetch;
    (global as any).fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
    try {
      await svc.ingestDocument('d-1', 'kb-1', 'org-1');
      expect(prisma.chunkInsertCount()).toBeGreaterThan(0);
      expect(prisma._documents.get('d-1').status).toBe('COMPLETED');
    } finally {
      (global as any).fetch = originalFetch;
    }
  });

  it('2. COMPLETED document → no-op (CRITIQUE 7 fix: true idempotence)', async () => {
    const { svc, prisma } = makeService();
    prisma.seedKb('kb-1');
    prisma.seedDoc('d-1', { status: 'COMPLETED', processedAt: new Date() });
    await svc.ingestDocument('d-1', 'kb-1', 'org-1');
    // After CRITIQUE 7 fix: the guard at the top of ingestDocument
    // returns early for COMPLETED status, so no chunks are inserted.
    expect(prisma.chunkInsertCount()).toBe(0);
  });

  it('2b. FAILED document → re-processes (retry path, CRITIQUE 7 fix)', async () => {
    const { svc, prisma } = makeService();
    prisma.seedKb('kb-1');
    prisma.seedDoc('d-1', { status: 'FAILED', error: 'previous error' });
    const originalFetch = (global as any).fetch;
    (global as any).fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
    try {
      await svc.ingestDocument('d-1', 'kb-1', 'org-1');
      // FAILED must be re-processable (retry path). Chunks are inserted.
      expect(prisma.chunkInsertCount()).toBeGreaterThan(0);
    } finally {
      (global as any).fetch = originalFetch;
    }
  });

  it('3. missing document → no-op (no chunks, no error)', async () => {
    const { svc, prisma } = makeService();
    prisma.seedKb('kb-1');
    await svc.ingestDocument('missing', 'kb-1', 'org-1');
    expect(prisma.chunkInsertCount()).toBe(0);
  });

  it('4. extraction failure → status=FAILED', async () => {
    const { svc, prisma, text } = makeService();
    prisma.seedKb('kb-1');
    prisma.seedDoc('d-1', { status: 'PENDING' });
    text.extract = async () => ({ text: '', metadata: {} });
    const originalFetch = (global as any).fetch;
    (global as any).fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
    try {
      await svc.ingestDocument('d-1', 'kb-1', 'org-1');
      // No extractable text → BadRequest is caught → status=FAILED
      expect(prisma._documents.get('d-1').status).toBe('FAILED');
    } finally {
      (global as any).fetch = originalFetch;
    }
  });

  it('5. missing KB → no-op', async () => {
    const { svc, prisma } = makeService();
    prisma.seedDoc('d-1', { status: 'PENDING' });
    await svc.ingestDocument('d-1', 'missing-kb', 'org-1');
    expect(prisma.chunkInsertCount()).toBe(0);
  });
});
