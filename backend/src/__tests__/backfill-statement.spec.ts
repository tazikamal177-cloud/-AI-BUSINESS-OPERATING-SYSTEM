/**
 * Unit test for the backfill-statement extractor.
 *
 * Verifies that the extractor reads the canonical .sql file and
 * returns the same backfill statement that is embedded in it.
 * This is the only way to guarantee that the e2e test and the
 * staging migration use the same SQL without running a real DB.
 */
import { getBackfillStatement } from '../../test/integration/backfill-statement';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('backfill-statement extractor', () => {
  it('returns a non-empty statement', () => {
    const sql = getBackfillStatement();
    expect(sql.length).toBeGreaterThan(0);
  });

  it('starts with the canonical UPDATE workflow_runs wr', () => {
    const sql = getBackfillStatement();
    expect(sql.replace(/\s+/g, ' ').trim().toUpperCase()).toMatch(
      /^UPDATE\s+WORKFLOW_RUNS\s+WR\b/,
    );
  });

  it('contains the canonical WHERE clauses', () => {
    const sql = getBackfillStatement();
    const normalized = sql.replace(/\s+/g, ' ').trim();
    expect(normalized).toMatch(/wr\.workflow_id\s*=\s*w\.id/i);
    expect(normalized).toMatch(/wr\.organization_id\s+IS\s+NULL/i);
  });

  it('matches the statement embedded in the SQL file (byte-for-byte equivalent)', () => {
    // Resolve the same way the extractor does: walk up from __dirname.
    let dir = __dirname;
    let sqlFile: string | null = null;
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, 'prisma', 'sql', 'phase8_add_workflow_run_org.sql');
      if (fs.existsSync(candidate)) { sqlFile = candidate; break; }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    expect(sqlFile).not.toBeNull();
    const fileContent = fs.readFileSync(sqlFile!, 'utf8');
    const re = /UPDATE\s+workflow_runs\s+wr[\s\S]+?;/i;
    const m = re.exec(fileContent);
    expect(m).not.toBeNull();
    const expected = m![0].trim();
    const actual = getBackfillStatement();
    expect(actual).toBe(expected);
  });

  it('terminates with a semicolon', () => {
    const sql = getBackfillStatement();
    expect(sql.trim().endsWith(';')).toBe(true);
  });
});

describe('backfill-statement extractor — failure modes', () => {
  it('throws if the .sql file is absent (fail loud, never returns empty/undefined)', async () => {
    // Re-import the module with a fake fs that hides the SQL file.
    // This forces resolveSqlFile() to walk 8 levels without finding it,
    // and proves the documented throw.
    jest.resetModules();
    jest.doMock('node:fs', () => {
      const realFs = jest.requireActual('node:fs');
      return {
        ...realFs,
        existsSync: (p: string) => {
          if (typeof p === 'string' && p.endsWith('phase8_add_workflow_run_org.sql')) {
            return false;
          }
          return realFs.existsSync(p);
        },
        readFileSync: (p: string, ...rest: any[]) => {
          if (typeof p === 'string' && p.endsWith('phase8_add_workflow_run_org.sql')) {
            throw new Error('ENOENT: simulated missing file');
          }
          return realFs.readFileSync(p, ...rest);
        },
      };
    });
    let threw = false;
    let msg = '';
    try {
      const mod = await import('../../test/integration/backfill-statement');
      mod.getBackfillStatement();
    } catch (e: any) {
      threw = true;
      msg = String(e && e.message || e);
    }
    expect(threw).toBe(true);
    expect(msg).toMatch(/could not locate|ENOENT/i);
    jest.dontMock('node:fs');
    jest.resetModules();
  });

  it('never returns an empty string or undefined (defensive check on real file)', () => {
    const sql = getBackfillStatement();
    expect(typeof sql).toBe('string');
    expect(sql).toBeTruthy();
    expect(sql.length).toBeGreaterThan(0);
    // The cached value is the real statement (verified by another test).
    // We do NOT call getBackfillStatement() on a missing file here — that
    // is covered by the previous test.
  });
});
