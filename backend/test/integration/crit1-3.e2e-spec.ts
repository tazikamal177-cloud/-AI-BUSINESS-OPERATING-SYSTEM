/**
 * AIBOS — Integration tests for CRITIQUES 1, 2, 3
 *
 * These tests are NOT mocks. They exercise:
 *
 *   CRITIQUE 1 — RLS isolation on `tools` and `invitations`
 *     • Create two orgs (A, B) with users.
 *     • Insert a tool in org A directly via Prisma.
 *     • Set the RLS context to org B and assert the tool from org A
 *       is NOT visible.
 *     • Same for invitations.
 *
 *   CRITIQUE 3 — WorkflowRun.organization_id backfill + RLS isolation
 *     • Create a workflow in org A.
 *     • Insert a workflow_run with organization_id = NULL directly
 *       (simulating a pre-Phase-8 row).
 *     • Run the backfill statement (same SQL as
 *       prisma/sql/phase8_add_workflow_run_org.sql).
 *     • Assert organization_id is now populated AND that org B cannot
 *       see this run under RLS.
 *
 * CRITIQUE 2 (SSRF) is in crit2-ssrf.e2e-spec.ts (no DB required).
 *
 * Run
 *   docker compose -f docker/docker-compose.yml up -d   # postgres+redis
 *   npm run db:reset                                  # apply schema + RLS + seed
 *   npm run test:e2e -- crit1-3
 *
 * These tests SKIP automatically if DATABASE_URL is not set, so they
 * don't break local dev for engineers who don't have Postgres running.
 * Imports of AppModule / PrismaService are deferred to beforeAll so that
 * the absence of env vars doesn't crash the file at load time.
 */

const SKIP = !process.env.DATABASE_URL;
const describeDb = SKIP ? describe.skip : describe;

describeDb('CRITIQUE 1 — RLS isolation on `tools` and `invitations`', () => {
  let app: any;
  let prisma: any;
  let orgA: any, orgB: any;
  let userA: string;

  beforeAll(async () => {
    const testing = await import('@nestjs/testing');
    const { AppModule } = await import('../../src/app.module');
    const { PrismaService } = await import('../../src/prisma/prisma.service');
    const mod = await testing.Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    // Two throwaway orgs/users with a unique tag to avoid collisions
    const tag = `crit1-${Date.now()}`;
    orgA = await prisma.organization.create({
      data: { name: `OrgA-${tag}`, slug: `org-a-${tag}` },
    });
    orgB = await prisma.organization.create({
      data: { name: `OrgB-${tag}`, slug: `org-b-${tag}` },
    });
    const u = await prisma.user.create({
      data: {
        email: `ua-${tag}@test.local`,
        passwordHash: 'x',
        firstName: 'U',
        lastName: 'A',
        emailVerifiedAt: new Date(),
      },
    });
    userA = u.id;
    await prisma.organizationMember.createMany({
      data: [
        { organizationId: orgA.id, userId: userA, role: 'OWNER' },
        { organizationId: orgB.id, userId: userA, role: 'OWNER' },
      ],
    });
  });

  afterAll(async () => {
    // Cleanup in dependency order
    if (prisma) {
      await prisma.tool.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
      // invitations is a raw SQL table, not a Prisma model
      await prisma.$executeRawUnsafe(
        `DELETE FROM invitations WHERE organization_id IN ($1, $2)`,
        orgA.id,
        orgB.id,
      );
      await prisma.organizationMember.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
      await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
      await prisma.user.delete({ where: { id: userA } });
    }
    if (app) await app.close();
  });

  it('CRITIQUE 1a — a tool created in org A is not visible from org B (RLS)', async () => {
    // Insert a tool directly in org A
    const tool = await prisma.$executeRawUnsafe(
      `INSERT INTO tools (id, organization_id, slug, name, description, type, input_schema, risk_level, status, is_built_in, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'ToolA', 'A-only tool', 'CUSTOM', '{}'::jsonb, 'LOW', 'ACTIVE', false, now(), now())`,
      [orgA.id, `crit1-tool-a-${Date.now()}`],
    );
    expect(tool).toBe(1);

    // Bind RLS context to org B and try to read the tool we just created
    // (identified by its slug)
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id::text AS id FROM tools WHERE slug = $1 AND organization_id = $2`,
      `crit1-tool-a-${Date.now() - 1}`,
      orgB.id,
    ).catch(() => [] as any[]);

    // Better: count tools scoped to orgA while context is bound to orgB
    // (via the RLS helper functions used elsewhere in the app).
    // We simulate the org-binding by running a query that should be filtered:
    // set_config() is used by the tenant interceptor in-process, but for
    // a raw test we set it explicitly.
    const pg = await import('pg');
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(`SELECT set_config('app.current_org_id', $1, false)`, [orgB.id]);
      await client.query(`SELECT set_config('app.current_user_id', $1, false)`, [userA]);
      await client.query(`SELECT set_config('app.is_service', 'false', false)`);

      // Try to read any tool from orgA
      const leaks = await client.query(
        `SELECT count(*)::int AS n FROM tools WHERE organization_id = $1`,
        [orgA.id],
      );
      expect(leaks.rows[0].n).toBe(0);

      // Switch to orgA — tool becomes visible
      await client.query(`SELECT set_config('app.current_org_id', $1, false)`, [orgA.id]);
      const visible = await client.query(
        `SELECT count(*)::int AS n FROM tools WHERE organization_id = $1`,
        [orgA.id],
      );
      expect(visible.rows[0].n).toBeGreaterThanOrEqual(1);
    } finally {
      await client.end();
    }
  }, 30_000);

  it('CRITIQUE 1b — an invitation in org A is not visible from org B (RLS)', async () => {
    const pg = await import('pg');
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      // Insert an invitation directly in org A (bypassing the service)
      await client.query(
        `INSERT INTO invitations (email, organization_id, role, token_hash, expires_at)
         VALUES ($1, $2, 'OPERATOR', encode(gen_random_bytes(32), 'hex'), now() + interval '7 days')`,
        [`crit1-invite-${Date.now()}@test.local`, orgA.id],
      );

      // org B context — invitation must be invisible
      await client.query(`SELECT set_config('app.current_org_id', $1, false)`, [orgB.id]);
      const leaks = await client.query(
        `SELECT count(*)::int AS n FROM invitations WHERE organization_id = $1`,
        [orgA.id],
      );
      expect(leaks.rows[0].n).toBe(0);

      // org A context — invitation must be visible
      await client.query(`SELECT set_config('app.current_org_id', $1, false)`, [orgA.id]);
      const visible = await client.query(
        `SELECT count(*)::int AS n FROM invitations WHERE organization_id = $1`,
        [orgA.id],
      );
      expect(visible.rows[0].n).toBeGreaterThanOrEqual(1);
    } finally {
      await client.end();
    }
  }, 30_000);
});

describeDb('CRITIQUE 3 — WorkflowRun.organization_id backfill + RLS isolation', () => {
  let app: any;
  let prisma: any;
  let orgA: any, orgB: any;
  let userA: string;
  let workflowId: string;

  beforeAll(async () => {
    const testing = await import('@nestjs/testing');
    const { AppModule } = await import('../../src/app.module');
    const { PrismaService } = await import('../../src/prisma/prisma.service');
    const mod = await testing.Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const tag = `crit3-${Date.now()}`;
    orgA = await prisma.organization.create({ data: { name: `OrgA-${tag}`, slug: `org-a-${tag}` } });
    orgB = await prisma.organization.create({ data: { name: `OrgB-${tag}`, slug: `org-b-${tag}` } });
    const u = await prisma.user.create({
      data: {
        email: `uc-${tag}@test.local`,
        passwordHash: 'x',
        firstName: 'C',
        lastName: 'Three',
        emailVerifiedAt: new Date(),
      },
    });
    userA = u.id;
    await prisma.organizationMember.createMany({
      data: [
        { organizationId: orgA.id, userId: userA, role: 'OWNER' },
        { organizationId: orgB.id, userId: userA, role: 'OWNER' },
      ],
    });

    const wf = await prisma.workflow.create({
      data: {
        organizationId: orgA.id,
        name: 'Test WF',
        trigger: 'MANUAL',
        triggerConfig: {},
        definition: { nodes: [{ id: 't', type: 'TRIGGER', name: 'T' }], edges: [] },
        createdBy: userA,
        version: 1,
        status: 'DRAFT',
      },
    });
    workflowId = wf.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.workflowRun.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
      await prisma.workflow.deleteMany({ where: { id: workflowId } });
      await prisma.organizationMember.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
      await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
      await prisma.user.delete({ where: { id: userA } });
    }
    if (app) await app.close();
  });

  it('CRITIQUE 3a — backfill populates organization_id on pre-existing NULL rows', async () => {
    const pg = await import('pg');
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      // Simulate a pre-Phase-8 row: organization_id NULL
      await client.query(`ALTER TABLE workflow_runs DROP CONSTRAINT IF EXISTS workflow_runs_organization_id_not_null`);
      // (the NOT NULL constraint may not exist yet on a fresh DB; this is defensive)
      const insert = await client.query(
        `INSERT INTO workflow_runs (id, workflow_id, workflow_version, status, trigger_data, snapshot, started_at)
         VALUES (gen_random_uuid(), $1, 1, 'PENDING', '{}'::jsonb, '{}'::jsonb, now())
         RETURNING id`,
        [workflowId],
      );
      const runId = insert.rows[0].id;

      // Before backfill, organization_id should be NULL
      const before = await client.query(`SELECT organization_id FROM workflow_runs WHERE id = $1`, [runId]);
      expect(before.rows[0].organization_id).toBeNull();

      // Run the backfill. The SQL text comes from the canonical
      // migration file (prisma/sql/phase8_add_workflow_run_org.sql,
      // step 2) so the test exercises the exact same statement that
      // will run in staging.
      const { getBackfillStatement } = await import('./backfill-statement');
      await client.query(getBackfillStatement());

      // After backfill, organization_id should be populated
      const after = await client.query(`SELECT organization_id FROM workflow_runs WHERE id = $1`, [runId]);
      expect(after.rows[0].organization_id).toBe(orgA.id);
    } finally {
      await client.end();
    }
  }, 30_000);

  it('CRITIQUE 3b — after backfill, the run is invisible to org B under RLS', async () => {
    const pg = await import('pg');
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      // Switch RLS context to org B
      await client.query(`SELECT set_config('app.current_org_id', $1, false)`, [orgB.id]);
      await client.query(`SELECT set_config('app.is_service', 'false', false)`);
      const leaks = await client.query(
        `SELECT count(*)::int AS n FROM workflow_runs WHERE workflow_id = $1`,
        [workflowId],
      );
      expect(leaks.rows[0].n).toBe(0);

      // Switch to org A — should be visible
      await client.query(`SELECT set_config('app.current_org_id', $1, false)`, [orgA.id]);
      const visible = await client.query(
        `SELECT count(*)::int AS n FROM workflow_runs WHERE workflow_id = $1`,
        [workflowId],
      );
      expect(visible.rows[0].n).toBeGreaterThanOrEqual(1);
    } finally {
      await client.end();
    }
  }, 30_000);
});
