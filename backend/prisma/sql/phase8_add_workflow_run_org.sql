-- =============================================================================
-- AIBOS — Phase 8 hotfix : add organization_id to workflow_runs
-- =============================================================================
--
-- Context
--   WorkflowRun was created in Phase 1 without organization_id. The column
--   was added to schema.prisma during Phase 8 (graph engine) but no Prisma
--   migration was generated. This script is the safe, idempotent migration
--   to apply the change to an existing database.
--
-- What it does, in order
--   1. Add organization_id as NULLABLE (rows already exist).
--   2. Backfill organization_id from workflows.organization_id for any
--      existing rows that lack it.
--   3. Promote organization_id to NOT NULL (only if no NULLs remain).
--   4. Add the FK to organizations(id) ON DELETE CASCADE if missing.
--   5. Add the (organization_id) and (organization_id, started_at) indexes
--      if missing.
--   6. Verify that the RLS policy wf_runs_all exists and references
--      organization_id (it should — see prisma/sql/rls.sql). If absent,
--      install a safe policy and report.
--
-- Safety
--   - All operations are idempotent (IF NOT EXISTS / DO blocks).
--   - The script aborts with a clear error if any backfill row has no
--     matching workflow (orphaned runs), so the operator can inspect.
--   - Run it inside a transaction. The NOT NULL promotion is split out
--     so it can be re-run if a manual fix is needed.
--
-- Usage
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/phase8_add_workflow_run_org.sql
--   -- or
--   npm run prisma:phase8
-- =============================================================================

BEGIN;

-- 1. Add column (nullable first, to accept existing rows)
ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS organization_id uuid;

-- 2. Backfill from the parent workflow
UPDATE workflow_runs wr
SET    organization_id = w.organization_id
FROM   workflows w
WHERE  wr.workflow_id = w.id
  AND  wr.organization_id IS NULL;

-- 2b. Abort if any rows remain NULL (orphaned runs)
DO $$
DECLARE
  remaining int;
BEGIN
  SELECT count(*) INTO remaining FROM workflow_runs WHERE organization_id IS NULL;
  IF remaining > 0 THEN
    RAISE EXCEPTION
      'phase8 hotfix aborted: % workflow_runs rows still have NULL organization_id. Inspect with: SELECT id, workflow_id FROM workflow_runs WHERE organization_id IS NULL',
      remaining;
  END IF;
END
$$;

-- 3. Promote to NOT NULL (only if not already)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workflow_runs' AND column_name = 'organization_id' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE workflow_runs ALTER COLUMN organization_id SET NOT NULL;
  END IF;
END
$$;

-- 4. Add FK if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'workflow_runs_organization_id_fkey'
      AND table_name = 'workflow_runs'
  ) THEN
    ALTER TABLE workflow_runs
      ADD CONSTRAINT workflow_runs_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END
$$;

-- 5. Indexes
CREATE INDEX IF NOT EXISTS workflow_runs_organization_id_idx
  ON workflow_runs (organization_id);

CREATE INDEX IF NOT EXISTS workflow_runs_organization_id_started_at_idx
  ON workflow_runs (organization_id, started_at);

-- 6. Ensure RLS is enabled and a policy exists.
--    (rls.sql is the canonical source; this is a safety net for instances
--     where rls.sql was applied but the policy name changed.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'workflow_runs' AND relrowsecurity = true
  ) THEN
    ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'workflow_runs'
  ) THEN
    CREATE POLICY wf_runs_all ON workflow_runs
      FOR ALL USING (
        aibos_is_service() OR organization_id = aibos_current_org()
      )
      WITH CHECK (
        aibos_is_service() OR organization_id = aibos_current_org()
      );
    RAISE NOTICE 'phase8 hotfix: created wf_runs_all policy (rls.sql was missing it)';
  END IF;
END
$$;

COMMIT;

-- =============================================================================
-- Post-run verification (caller can grep these):
--
--   SELECT count(*) FROM workflow_runs WHERE organization_id IS NULL;
--     -- expect: 0
--
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'workflow_runs';
--     -- expect: relrowsecurity = t
--
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'workflow_runs';
--     -- expect: wf_runs_all, ALL
--
--   SELECT indexname FROM pg_indexes WHERE tablename = 'workflow_runs'
--     AND indexname IN (
--       'workflow_runs_organization_id_idx',
--       'workflow_runs_organization_id_started_at_idx'
--     );
--     -- expect: both rows
-- =============================================================================
