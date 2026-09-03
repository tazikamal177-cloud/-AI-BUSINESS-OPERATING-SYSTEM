-- ============================================================================
-- AIBOS — pgvector ANN indexes
-- ============================================================================
-- Created AFTER bulk data load (per pgvector best practice).
-- IVFFlat lists = sqrt(rows); revisit after reaching 100k+ chunks per org
-- and consider switching to HNSW for higher recall.
-- ============================================================================

-- Generic vector index on document_chunks (RLS already scopes per org)
CREATE INDEX IF NOT EXISTS document_chunks_embedding_ivf
  ON document_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS memories_embedding_ivf
  ON memories
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ANALYZE is run by the seed/ingest script after bulk load
