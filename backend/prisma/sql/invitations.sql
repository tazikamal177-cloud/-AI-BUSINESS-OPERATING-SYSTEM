-- ============================================================================
-- AIBOS — Invitations table (raw SQL; not a Prisma model in Phase 3)
-- ============================================================================

CREATE TABLE IF NOT EXISTS invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           varchar(255) NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role            "MemberRole" NOT NULL DEFAULT 'OPERATOR',
  token_hash      char(64) NOT NULL,           -- sha256 hex of the raw token
  invited_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at      timestamptz NOT NULL,
  accepted_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- One pending invite per (org, email)
CREATE UNIQUE INDEX IF NOT EXISTS invitations_pending_unique
  ON invitations (organization_id, email)
  WHERE accepted_at IS NULL;

CREATE INDEX IF NOT EXISTS invitations_org_idx       ON invitations (organization_id);
CREATE INDEX IF NOT EXISTS invitations_token_idx     ON invitations (token_hash);
CREATE INDEX IF NOT EXISTS invitations_email_idx     ON invitations (email);

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY invitations_all ON invitations
  FOR ALL USING (aibos_is_service() OR organization_id = aibos_current_org())
  WITH CHECK (aibos_is_service() OR organization_id = aibos_current_org());
