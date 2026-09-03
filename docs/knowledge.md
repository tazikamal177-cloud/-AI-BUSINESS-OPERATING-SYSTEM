# Knowledge / RAG — Phase 6

## Goal
Allow organizations to upload documents, extract their text, chunk them, embed
them into `pgvector`, and retrieve the most relevant excerpts at inference time.

## Architecture

```
                            ┌──────────────────┐
   PDF/DOCX/TXT/CSV/HTML ──▶│   extractors.ts  │  (per-format parser)
   URL/webpage              └────────┬─────────┘
                                      │ text + metadata
                                      ▼
                            ┌──────────────────┐
                            │ text-chunker.ts  │  (recursive splitter, 800/200 tokens)
                            └────────┬─────────┘
                                     │ array<string>
                                     ▼
                       ┌──────────────────────────┐
                       │ AiGatewayService.embedBatch │ (OpenAI, 100/batch)
                       └────────┬─────────────────┘
                                │ number[][]
                                ▼
                  ┌──────────────────────────┐
                  │  document_chunks (pgvector)  │  (raw SQL insert for vector)
                  └────────────────────────────┘

  Agent runtime query
            │
            ▼
   AiGatewayService.embed(query)
            │
            ▼
   RagService.retrieve()   ── pgvector cosine top-K  (RLS-scoped, multi-KB)
            │
            ▼
   RagService.buildContext()  ── injected into system prompt
```

## Extractors (`src/modules/knowledge/extractors/extractors.ts`)

| Type    | Trigger                                       | Library                |
|---------|-----------------------------------------------|------------------------|
| PDF     | `application/pdf` or `.pdf`                   | `pdf-parse`            |
| DOCX    | `.docx` / `application/vnd.openxmlformats…`   | `mammoth`              |
| Text    | `text/*` or any `.(txt\|md\|json\|py\|…\|html)` | utf-8 decode         |
| CSV     | `text/csv` / `.csv`                           | custom RFC 4180 parser |
| HTML    | `.html` / `text/html`                         | `cheerio`              |
| URL     | `{ url }` body field                          | `fetch` + `cheerio`    |

All extractors implement `Extractor` (`supports()` + `extract()`) and return
`{ text, metadata }`. Metadata is persisted in `document_chunks.metadata` (e.g.
`{ pages, headers, rowCount, title }`).

## Chunker (`src/modules/knowledge/chunker/text-chunker.ts`)

Recursive splitter. Default 800 tokens / 200 overlap.

- Hierarchical separators: paragraph → line → sentence → word.
- Greedy merge to hit `chunkSize` while preserving natural boundaries.
- Overlap of `chunkOverlap` tokens between consecutive chunks (decoded via
  `gpt-3-encoder` for exactness).
- Hard-split as a fallback when a single segment exceeds the budget.

Token counting uses `gpt-3-encoder` (cl100k_base, same as OpenAI
`text-embedding-3-*`).

## Ingestion pipeline (`knowledge.service.ts → ingestDocument`)

1. `Document` row created with `status=PENDING`.
2. S3 upload (StorageService, `knowledge/{orgId}/{uuid}.{ext}`).
3. Trigger ingestion: **inline** for files < 1 MB, **enqueued** for larger
   files (BullMQ worker added in Phase 7).
4. `PROCESSING` → download from S3 → extract → chunk → embed (batches of 100
   per OpenAI request) → insert chunks via raw SQL (pgvector literal).
5. `COMPLETED` (or `FAILED` with truncated error message).

Insertion is raw SQL because Prisma cannot represent the `vector(1536)` type:

```sql
INSERT INTO document_chunks (id, document_id, organization_id, content,
  chunk_index, token_count, metadata, embedding, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, now())
```

The `organization_id` column is **denormalized** on `document_chunks` to
simplify RAG filtering (avoids a join to `documents` for every query).

## RAG retrieval (`RagService.retrieve`)

```sql
SELECT dc.id, dc.content, dc.metadata, dc.document_id, d.original_name,
       (dc.embedding <=> $1) AS distance
FROM   document_chunks dc
JOIN   documents d ON d.id = dc.document_id
WHERE  d.organization_id = $2              -- RLS binds this automatically
  AND  d.knowledge_base_id = ANY($3::uuid[])
  AND  d.deleted_at IS NULL
ORDER  BY distance ASC
LIMIT  $4
```

`buildContext()` formats the chunks as `## Knowledge` blocks the runtime
injects into the system prompt. Each block is numbered (`[#1 — doc.pdf]`) so
the model can cite sources.

## Routes (`knowledge.controller.ts`)

All routes are under `/knowledge-bases` and protected by `JwtAuthGuard` +
`OrganizationGuard` (RLS is active on the request).

| Method | Path                                            | Purpose                          |
|--------|-------------------------------------------------|----------------------------------|
| GET    | `/knowledge-bases`                              | List KBs in current org          |
| GET    | `/knowledge-bases/:kbId`                        | Get a KB with documents          |
| POST   | `/knowledge-bases`                              | Create a KB                      |
| PATCH  | `/knowledge-bases/:kbId`                        | Update name/description/chunking |
| DELETE | `/knowledge-bases/:kbId`                        | Soft-delete KB + cascade docs    |
| GET    | `/knowledge-bases/:kbId/documents`              | List documents                   |
| POST   | `/knowledge-bases/:kbId/documents`              | **Upload** (`file` or `url`)     |
| POST   | `/knowledge-bases/:kbId/documents/:docId/reindex` | Re-extract + re-embed         |
| DELETE | `/knowledge-bases/:kbId/documents/:docId`       | Soft-delete + cascade chunks     |
| POST   | `/knowledge-bases/:kbId/search`                 | Debug RAG (cites top-K chunks)   |
| GET    | `/knowledge-bases/:kbId/search?query=…&topK=…`  | Quick GET variant for testing    |

### Upload examples

**File upload** (`multipart/form-data`, field `file`, max 50 MB):

```bash
curl -X POST $URL/knowledge-bases/$KB/documents \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./manual.pdf"
```

**URL ingestion**:

```bash
curl -X POST $URL/knowledge-bases/$KB/documents \
  -H "Authorization: Bearer $TOKEN" \
  -F "url=https://example.com/article"
```

## Security & multi-tenancy

- Documents, chunks and KBs are all filtered by `organization_id` (RLS
  policies from `prisma/sql/rls.sql`).
- S3 keys are tenant-scoped: `knowledge/{orgId}/{uuid}.{ext}`.
- Upload is hard-capped at 50 MB by `FileInterceptor`.
- Deleting a document removes its chunks in a transaction and best-effort
  deletes the S3 object.

## Tests

- `text-chunker.spec.ts` — boundary handling, overlap, paragraph preservation,
  invalid arguments, token counts.
- `extractors.spec.ts` — CSV quoting, HTML stripping, text decoding,
  extension-based detection.

```
PASS src/modules/knowledge/__tests__/text-chunker.spec.ts
PASS src/modules/knowledge/__tests__/extractors.spec.ts
Tests: 13 passed, 13 total
```

## Known limitations & next steps

- BullMQ worker integration is deferred to Phase 7 (queue + retry + DLQ).
- Re-embedding on model change is not automatic; call `/reindex` per document.
- The hard-split fallback in the chunker is character-based; a smarter fallback
  could re-run the recursive pass at a finer separator.
- HTML extraction strips all scripts/styles; SPA hydration text is not
  captured (URL extractor only fetches the static HTML).
