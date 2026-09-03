/**
 * Single source of truth for the workflow_runs.organization_id backfill.
 *
 * The migration script (prisma/sql/phase8_add_workflow_run_org.sql) contains
 * 6 steps in a transaction. The RLS/tenant-isolation e2e test
 * (test/integration/crit1-3.e2e-spec.ts) needs to run only the backfill
 * step (step 2) to verify that the SQL works as expected.
 *
 * Both consumers MUST read the same SQL text. This module reads the .sql
 * file at module-load time and extracts the backfill statement. If the
 * file is modified, both consumers see the new version.
 *
 * Usage:
 *   const { backfillSql } = require('./backfill-statement');
 *   await client.query(backfillSql);
 *
 * If the .sql file is missing or the backfill statement is not found,
 * the import throws — this is intentional, since both consumers would
 * be broken anyway.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

function resolveSqlFile(): string {
  // Walk up the directory tree until we find the canonical .sql file.
  // This is robust against the test runner remapping __dirname.
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'prisma', 'sql', 'phase8_add_workflow_run_org.sql');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `backfill-statement: could not locate phase8_add_workflow_run_org.sql by walking up from ${__dirname}`,
  );
}

const SQL_FILE = resolveSqlFile();

function extractBackfill(sqlText: string): string {
  // Match the UPDATE workflow_runs wr ... statement. Greedy enough to
  // capture multi-line; the statement ends at the first standalone ';'.
  const re = /UPDATE\s+workflow_runs\s+wr[\s\S]+?;/i;
  const m = re.exec(sqlText);
  if (!m) {
    throw new Error(
      `backfill-statement: could not find "UPDATE workflow_runs wr ..." in ${SQL_FILE}`,
    );
  }
  return m[0].trim();
}

let cached: string | null = null;

export function getBackfillStatement(): string {
  if (cached !== null) return cached;
  if (!fs.existsSync(SQL_FILE)) {
    throw new Error(`backfill-statement: SQL file not found at ${SQL_FILE}`);
  }
  const text = fs.readFileSync(SQL_FILE, 'utf8');
  cached = extractBackfill(text);
  return cached;
}
