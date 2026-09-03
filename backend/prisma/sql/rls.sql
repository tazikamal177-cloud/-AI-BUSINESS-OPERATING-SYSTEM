-- ============================================================================
-- AIBOS — Row-Level Security (RLS) policies
-- ============================================================================
-- Defense-in-depth for multi-tenancy. Even if a NestJS service forgets to
-- filter by `organization_id`, Postgres will refuse the row.
--
-- Connection setup (handled by Prisma middleware in NestJS):
--   Per-request, before any query:
--     SET LOCAL app.current_user_id  = '<user_id>';
--     SET LOCAL app.current_org_id   = '<organization_id>';
--     SET LOCAL app.is_service       = 'true' | 'false';   -- bypass for jobs
--
-- All tenant-owned tables have `organization_id uuid not null`.
-- Global tables (`users`, `plans`, `tools` registry built-ins) have no RLS.
-- ============================================================================

-- Helper: read current org id from session GUC
CREATE OR REPLACE FUNCTION aibos_current_org() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION aibos_is_service() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.is_service', true), ''), 'false')::boolean
$$;

-- ============================================================================
-- Enable RLS on every tenant-scoped table
-- ============================================================================

ALTER TABLE organizations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_versions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tools              ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_knowledge          ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_bases          ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents                ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tools                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_executions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_credentials  ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows                ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_nodes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_edges           ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_run_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records            ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications            ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Generic policy template (re-applied per table)
-- ============================================================================
-- SELECT: row.organization_id must equal current_org() OR caller is service
-- INSERT: row.organization_id MUST equal current_org() (service bypass)
-- UPDATE: same as SELECT
-- DELETE: same as SELECT
-- ============================================================================

-- Helper macro: apply the 4 standard policies to a tenant table.
-- We expand it manually per table for clarity.

-- organizations: a user can only see orgs they belong to
CREATE POLICY org_select ON organizations
  FOR SELECT USING (
    aibos_is_service() OR
    id IN (SELECT organization_id FROM organization_members WHERE user_id = aibos_current_user_id())
  );
CREATE POLICY org_modify ON organizations
  FOR ALL USING (aibos_is_service() OR id = aibos_current_org())
  WITH CHECK (aibos_is_service() OR id = aibos_current_org());

-- organization_members: scoped to current org
CREATE POLICY org_members_all ON organization_members
  FOR ALL USING (aibos_is_service() OR organization_id = aibos_current_org())
  WITH CHECK (aibos_is_service() OR organization_id = aibos_current_org());

-- subscriptions
CREATE POLICY subs_all ON subscriptions
  FOR ALL USING (aibos_is_service() OR organization_id = aibos_current_org())
  WITH CHECK (aibos_is_service() OR organization_id = aibos_current_org());

-- agents
CREATE POLICY agents_all ON agents
  FOR ALL USING (aibos_is_service() OR organization_id = aibos_current_org())
  WITH CHECK (aibos_is_service() OR organization_id = aibos_current_org());

-- agent_versions: scoped via parent agent
CREATE POLICY agent_versions_all ON agent_versions
  FOR ALL USING (
    aibos_is_service() OR
    agent_id IN (SELECT id FROM agents WHERE organization_id = aibos_current_org())
  )
  WITH CHECK (
    aibos_is_service() OR
    agent_id IN (SELECT id FROM agents WHERE organization_id = aibos_current_org())
  );

-- agent_tools
CREATE POLICY agent_tools_all ON agent_tools
  FOR ALL USING (
    aibos_is_service() OR
    agent_id IN (SELECT id FROM agents WHERE organization_id = aibos_current_org())
  )
  WITH CHECK (
    aibos_is_service() OR
    agent_id IN (SELECT id FROM agents WHERE organization_id = aibos_current_org())
  );

-- agent_knowledge
CREATE POLICY agent_knowledge_all ON agent_knowledge
  FOR ALL USING (
    aibos_is_service() OR
    agent_id IN (SELECT id FROM agents WHERE organization_id = aibos_current_org())
  )
  WITH CHECK (
    aibos_is_service() OR
    agent_id IN (SELECT id FROM agents WHERE organization_id = aibos_current_org())
  );

-- knowledge_bases
CREATE POLICY kb_all ON knowledge_bases
  FOR ALL USING (aibos_is_service() OR organization_id = aibos_current_org())
  WITH CHECK (aibos_is_service() OR organization_id = aibos_current_org());

-- documents
CREATE POLICY docs_all ON documents
  FOR ALL USING (aibos_is_service() OR organization_id = aibos_current_org())
  WITH CHECK (aibos_is_service() OR organization_id = aibos_current_org());

-- document_chunks: directly org_id (denormalized for performance)
CREATE POLICY chunks_all ON document_chunks
  FOR ALL USING (aibos_is_service() OR organization_id = aibos_current_org())
  WITH CHECK (aibos_is_service() OR organization_id = aibos_current_org());

-- conversations
CREATE POLICY conv_all ON conversations
  FOR ALL USING (aibos_is_service() OR organization_id = aibos_current_org())
  WITH CHECK (aibos_is_service() OR organization_id = aibos_current_org());

-- messages
CREATE POLICY messages_all ON messages
  FOR ALL USING (
    aibos_is_service() OR
    conversation_id IN (SELECT id FROM conversations WHERE organization_id = aibos_current_org())
  )
  WITH CHECK (
    aibos_is_service() OR
    conversation_id IN (SELECT id FROM conversations WHERE organization_id = aibos_current_org())
  );

-- tasks
CREATE POLICY tasks_all ON tasks
  FOR ALL USING (aibos_is_service() OR organization_id = aibos_current_org())
  WITH CHECK (aibos_is_service() OR organization_id = aibos_current_org());

-- tools: built-ins (organization_id IS NULL) visible to all authenticated; org-specific scoped
CREATE POLICY tools_all ON tools
  FOR ALL USING (
    aibos_is_service() OR
    organization_id IS NULL OR
    organization_id = aibos_current_org()
  )
  WITH CHECK (
    aibos_is_service() OR
    organization_id = aibos_current_org()  -- cannot create global tools from app
  );

-- tool_executions
CREATE POLICY tool_exec_all ON tool_executions
  FOR ALL USING (aibos_is_service() OR organization_id = aibos_current_org())
  WITH CHECK (aibos_is_service() OR organization_id = aibos_current_org());

-- integrations
CREATE POLICY integrations_all ON integrations
  FOR ALL USING (aibos_is_service() OR organization_id = aibos_current_org())
  WITH CHECK (aibos_is_service() OR organization_id = aibos_current_org());

-- integration_credentials
CREATE POLICY int_creds_all ON integration_credentials
  FOR ALL USING (
    aibos_is_service() OR
    integration_id IN (SELECT id FROM integrations WHERE organization_id = aibos_current_org())
  )
  WITH CHECK (
    aibos_is_service() OR
    integration_id IN (SELECT id FROM integrations WHERE organization_id = aibos_current_org())
  );

-- workflows
CREATE POLICY workflows_all ON workflows
  FOR ALL USING (aibos_is_service() OR organization_id = aibos_current_org())
  WITH CHECK (aibos_is_service() OR organization_id = aibos_current_org());

CREATE POLICY wf_nodes_all ON workflow_nodes
  FOR ALL USING (
    aibos_is_service() OR
    workflow_id IN (SELECT id FROM workflows WHERE organization_id = aibos_current_org())
  )
  WITH CHECK (
    aibos_is_service() OR
    workflow_id IN (SELECT id FROM workflows WHERE organization_id = aibos_current_org())
  );

CREATE POLICY wf_edges_all ON workflow_edges
  FOR ALL USING (
    aibos_is_service() OR
    workflow_id IN (SELECT id FROM workflows WHERE organization_id = aibos_current_org())
  )
  WITH CHECK (
    aibos_is_service() OR
    workflow_id IN (SELECT id FROM workflows WHERE organization_id = aibos_current_org())
  );

CREATE POLICY wf_runs_all ON workflow_runs
  FOR ALL USING (
    aibos_is_service() OR
    organization_id = aibos_current_org()
  )
  WITH CHECK (
    aibos_is_service() OR
    organization_id = aibos_current_org()
  );

CREATE POLICY wf_run_logs_all ON workflow_run_logs
  FOR ALL USING (
    aibos_is_service() OR
    workflow_run_id IN (
      SELECT id FROM workflow_runs WHERE organization_id = aibos_current_org()
    )
  )
  WITH CHECK (
    aibos_is_service() OR
    workflow_run_id IN (
      SELECT id FROM workflow_runs WHERE organization_id = aibos_current_org()
    )
  );

-- usage_records
CREATE POLICY usage_all ON usage_records
  FOR ALL USING (aibos_is_service() OR organization_id = aibos_current_org())
  WITH CHECK (aibos_is_service() OR organization_id = aibos_current_org());

-- audit_logs
CREATE POLICY audit_all ON audit_logs
  FOR ALL USING (aibos_is_service() OR organization_id = aibos_current_org())
  WITH CHECK (aibos_is_service() OR organization_id = aibos_current_org());

-- memories
CREATE POLICY memories_all ON memories
  FOR ALL USING (aibos_is_service() OR organization_id = aibos_current_org())
  WITH CHECK (aibos_is_service() OR organization_id = aibos_current_org());

-- notifications: scoped to user; org filter optional
CREATE POLICY notif_all ON notifications
  FOR ALL USING (aibos_is_service() OR user_id = aibos_current_user_id())
  WITH CHECK (aibos_is_service() OR user_id = aibos_current_user_id());

-- ============================================================================
-- Helper: read current user id (notifications policy + future use)
-- ============================================================================
CREATE OR REPLACE FUNCTION aibos_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

-- ============================================================================
-- Note on pgvector search
-- ============================================================================
-- RAG retrieval uses:
--   SELECT id, content, metadata
--   FROM document_chunks
--   WHERE organization_id = aibos_current_org()  -- (RLS adds this)
--   ORDER BY embedding <=> $1
--   LIMIT 5;
-- The IVFFlat index on `embedding` makes this efficient at the cost of
-- requiring ANALYZE after bulk inserts. See backend/scripts/reindex-vectors.ts.
