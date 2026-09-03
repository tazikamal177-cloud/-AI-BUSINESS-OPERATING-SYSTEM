/**
 * AIBOS — Cross-tenant isolation test
 *
 * This is the reference test that MUST be in CI for every new tenant-scoped
 * model. It verifies that:
 *   1. A user in Org A cannot read rows of Org B (should be 0 rows / 404).
 *   2. A user in Org A cannot insert a row tied to Org B.
 *   3. The pgvector search is also scoped (a query embedding never returns
 *      chunks from another org).
 *
 * Run with: `npm run test:e2e -- cross-tenant`
 *
 * The test uses two real organizations created by the seed, plus raw SQL
 * to bypass the Prisma client and assert that RLS *itself* blocks the access,
 * not just the application layer.
 */
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';

const prisma = new PrismaClient();
const pg = new Client({ connectionString: process.env.DATABASE_URL });

// All tenant-scoped tables with their organization_id column.
// Add new entries here when introducing a new tenant model.
const TENANT_TABLES: { table: string; orgColumn: string }[] = [
  { table: 'agents', orgColumn: 'organization_id' },
  { table: 'agent_versions', orgColumn: 'organization_id' },
  { table: 'agent_tools', orgColumn: 'organization_id' },
  { table: 'agent_knowledge', orgColumn: 'organization_id' },
  { table: 'audit_logs', orgColumn: 'organization_id' },
  { table: 'conversations', orgColumn: 'organization_id' },
  { table: 'messages', orgColumn: 'organization_id' },
  { table: 'document_chunks', orgColumn: 'organization_id' },
  { table: 'documents', orgColumn: 'organization_id' },
  { table: 'integration_credentials', orgColumn: 'integration_id' },
  { table: 'integrations', orgColumn: 'organization_id' },
  { table: 'invitations', orgColumn: 'organization_id' },
  { table: 'knowledge_bases', orgColumn: 'organization_id' },
  { table: 'organization_members', orgColumn: 'organization_id' },
  { table: 'subscription', orgColumn: 'organization_id' },
  { table: 'tasks', orgColumn: 'organization_id' },
  { table: 'tool_executions', orgColumn: 'organization_id' },
  { table: 'tools', orgColumn: 'organization_id' },
  { table: 'usage_records', orgColumn: 'organization_id' },
  { table: 'workflow_runs', orgColumn: 'organization_id' },
  { table: 'workflow_run_logs', orgColumn: 'workflow_run_id' },
  { table: 'workflows', orgColumn: 'organization_id' },
];

async function setContext(client: Client, userId: string, orgId: string) {
  await client.query(`SELECT set_config('app.current_user_id', $1, false)`, [userId]);
  await client.query(`SELECT set_config('app.current_org_id',  $1, false)`, [orgId]);
  await client.query(`SELECT set_config('app.is_service', 'false', false)`);
}

async function expectEmpty(label: string, fn: () => Promise<{ rowCount: number | null }>) {
  const r = await fn();
  const n = r.rowCount ?? 0;
  if (n !== 0) {
    throw new Error(`❌ ${label}: expected 0 rows, got ${n}`);
  }
  console.log(`  ✓ ${label}`);
}

async function main() {
  await pg.connect();

  // Resolve the two demo orgs + their owners from the seed
  const orgA = await prisma.organization.findUnique({ where: { slug: 'org-a-test' }, include: { members: true } });
  const orgB = await prisma.organization.findUnique({ where: { slug: 'org-b-test' }, include: { members: true } });
  if (!orgA || !orgB) {
    console.log('Skipping: run `npm run db:seed -- --with-test-orgs` first');
    return;
  }
  const userA = orgA.members[0].userId;
  const userB = orgB.members[0].userId;

  // ────────────────────────────────────────────────────────────
  // Test 1: User A cannot read rows of Org B for every tenant table
  // ────────────────────────────────────────────────────────────
  await setContext(pg, userA, orgA.id);
  for (const t of TENANT_TABLES) {
    if (t.orgColumn === 'workflow_run_id') {
      // Indirect: filtered via parent table. Use a literal to be safe.
      await expectEmpty(`userA cannot see orgB ${t.table}`, () =>
        pg
          .query(
            `SELECT 1 FROM ${t.table} r
             JOIN workflow_runs wr ON wr.id = r.workflow_run_id
             WHERE wr.organization_id = $1 LIMIT 1`,
            [orgB.id],
          )
          .then((r) => ({ rowCount: r.rowCount })),
      );
    } else if (t.orgColumn === 'integration_id') {
      await expectEmpty(`userA cannot see orgB ${t.table}`, () =>
        pg
          .query(
            `SELECT 1 FROM ${t.table} c
             JOIN integrations i ON i.id = c.integration_id
             WHERE i.organization_id = $1 LIMIT 1`,
            [orgB.id],
          )
          .then((r) => ({ rowCount: r.rowCount })),
      );
    } else {
      await expectEmpty(`userA cannot see orgB ${t.table}`, () =>
        pg.query(`SELECT 1 FROM ${t.table} WHERE ${t.orgColumn} = $1 LIMIT 1`, [orgB.id]).then((r) => ({ rowCount: r.rowCount })),
      );
    }
  }

  // ────────────────────────────────────────────────────────────
  // Test 2: User A cannot insert into Org B
  // ────────────────────────────────────────────────────────────
  try {
    await pg.query(
      `INSERT INTO agents (id, organization_id, name, slug, system_instructions, created_by, status)
       VALUES (gen_random_uuid(), $1, 'evil', 'evil', 'x', $2, 'DRAFT')`,
      [orgB.id, userA],
    );
    throw new Error('Insert was not blocked — RLS missing!');
  } catch (e: any) {
    if (!String(e.message).includes('row-level security') && !String(e.code).includes('42501')) {
      throw e;
    }
    console.log('  ✓ insert into other org blocked by RLS');
  }

  // ────────────────────────────────────────────────────────────
  // Test 3: pgvector search is also scoped
  // ────────────────────────────────────────────────────────────
  await setContext(pg, userA, orgA.id);
  const r = await pg.query(
    `SELECT id, organization_id FROM document_chunks ORDER BY embedding <=> (SELECT embedding FROM document_chunks LIMIT 1) LIMIT 5`,
  );
  if (r.rows.length === 0) {
    console.log('  ✓ vector search returned 0 rows (no chunks for org)');
  } else {
    const cross = r.rows.filter((row: any) => row.organization_id !== orgA.id);
    if (cross.length) {
      throw new Error(`❌ vector search leaked ${cross.length} rows across orgs`);
    }
    console.log(`  ✓ vector search returned ${r.rows.length} rows, all in current org`);
  }

  // ────────────────────────────────────────────────────────────
  // Test 4: switching context lets us read again
  // ────────────────────────────────────────────────────────────
  await setContext(pg, userB, orgB.id);
  const ok = await pg.query(`SELECT 1 FROM agents WHERE organization_id = $1 LIMIT 1`, [orgB.id]);
  if (ok.rowCount === 0) {
    throw new Error('❌ userB should be able to read orgB agents');
  }
  console.log('  ✓ userB can read orgB agents');

  console.log(`\n✅ Cross-tenant isolation OK (${TENANT_TABLES.length} tables)`);
}

main()
  .catch((e) => {
    console.error('❌ Cross-tenant test failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pg.end();
  });
