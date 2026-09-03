/**
 * Workflows — state transition tests (idempotence + invariants).
 *
 * Test-first protocol (CRITIQUE 6):
 *   - Tests in this file observe the service's current behavior.
 *   - If a test FAILS, the behavior is unexpected and we document it
 *     as a NEW CRITIQUE (we do NOT silently fix the service here).
 *   - We do not modify the service from this file.
 *
 * Targets:
 *   1. activate()  on a DRAFT workflow  → status=ACTIVE
 *   2. activate()  on an already-ACTIVE workflow → currently does it re-update? (observation)
 *   3. pause()     on an ACTIVE workflow  → status=PAUSED
 *   4. pause()     on a PAUSED workflow  → currently idempotent?
 *   5. pause()     on an ARCHIVED workflow  → currently allowed? (expected: rejected)
 *   6. activate()  on an ARCHIVED workflow → currently allowed? (expected: rejected)
 *   7. runWorkflow() on a non-ACTIVE workflow → rejected
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WorkflowsService } from '../workflows.service';

class FakePrisma {
  // Internal store
  private _workflows = new Map<string, any>();
  private _updates: Array<{ where: any; data: any }> = [];
  private _creates: any[] = [];

  workflow = {
    findFirst: jest.fn(async ({ where: { id, organizationId } }: any) => {
      const w = this._workflows.get(id);
      if (!w) return null;
      if (w.organizationId !== organizationId) return null;
      return { ...w };
    }),
    update: jest.fn(async ({ where: { id }, data }: any) => {
      this._updates.push({ where: { id }, data });
      const w = this._workflows.get(id);
      if (!w) throw new Error('not found');
      Object.assign(w, data);
      return { ...w };
    }),
  };

  workflowRun = {
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `wfr-${this._creates.length + 1}`, ...data };
      this._creates.push(row);
      return row;
    }),
  };

  // helpers
  seed(id: string, status: string) {
    this._workflows.set(id, {
      id, organizationId: 'org-1', name: 'test', status,
      definition: {
        nodes: [
          { id: 'n1', type: 'TRIGGER', data: { label: 'Start' } },
          { id: 'n2', type: 'END', data: { label: 'End' } },
        ],
        edges: [{ id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' }],
      },
      version: 1,
    });
  }
  get(id: string) { return this._workflows.get(id); }
}

class FakeRunner { /* no behavior used in this test */ }
class FakeAudit { log = jest.fn(async () => undefined); }

function makeService() {
  const prisma = new FakePrisma();
  const audit = new FakeAudit();
  const runner = new FakeRunner();
  const svc = new WorkflowsService(prisma as any, runner as any, audit as any);
  return { svc, prisma, audit };
}

const baseGraph = {
  nodes: [
    { id: 'n1', type: 'TRIGGER', data: { label: 'Start' } },
    { id: 'n2', type: 'END', data: { label: 'End' } },
  ],
  edges: [{ id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' }],
};

describe('WorkflowsService — state transitions', () => {
  it('1. activate(DRAFT) → status becomes ACTIVE', async () => {
    const { svc, prisma } = makeService();
    prisma.seed('wf-1', 'DRAFT');
    prisma.get('wf-1').definition = baseGraph;
    const result = await svc.activate('org-1', 'user-1', 'wf-1');
    expect(result.status).toBe('ACTIVE');
  });

  it('2. activate(already-ACTIVE) — observed behavior', async () => {
    const { svc, prisma } = makeService();
    prisma.seed('wf-1', 'ACTIVE');
    prisma.get('wf-1').definition = baseGraph;
    const result = await svc.activate('org-1', 'user-1', 'wf-1');
    // We don't assert a specific outcome; we observe. Today the service
    // performs an idempotent no-op (same status re-written).
    expect(['ACTIVE']).toContain(result.status);
  });

  it('3. pause(ACTIVE) → status becomes PAUSED', async () => {
    const { svc, prisma } = makeService();
    prisma.seed('wf-1', 'ACTIVE');
    const result = await svc.pause('org-1', 'user-1', 'wf-1');
    expect(result.status).toBe('PAUSED');
  });

  it('4. pause(PAUSED) — observed behavior', async () => {
    const { svc, prisma } = makeService();
    prisma.seed('wf-1', 'PAUSED');
    const result = await svc.pause('org-1', 'user-1', 'wf-1');
    expect(result.status).toBe('PAUSED');
  });

  it('5. pause(ARCHIVED) → BadRequest (CRITIQUE 7 fix)', async () => {
    const { svc, prisma } = makeService();
    prisma.seed('wf-1', 'ARCHIVED');
    await expect(svc.pause('org-1', 'user-1', 'wf-1')).rejects.toBeInstanceOf(BadRequestException);
    // Status must remain ARCHIVED (no partial update)
    expect(prisma.get('wf-1').status).toBe('ARCHIVED');
  });

  it('6. activate(ARCHIVED) → BadRequest (CRITIQUE 7 fix)', async () => {
    const { svc, prisma } = makeService();
    prisma.seed('wf-1', 'ARCHIVED');
    await expect(svc.activate('org-1', 'user-1', 'wf-1')).rejects.toBeInstanceOf(BadRequestException);
    // Status must remain ARCHIVED
    expect(prisma.get('wf-1').status).toBe('ARCHIVED');
  });

  it('7. runWorkflow on a DRAFT workflow → BadRequest', async () => {
    const { svc, prisma } = makeService();
    prisma.seed('wf-1', 'DRAFT');
    prisma.get('wf-1').definition = baseGraph;
    await expect(svc.runWorkflow('org-1', 'user-1', 'wf-1', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('8. workflow not found → NotFoundException', async () => {
    const { svc } = makeService();
    await expect(svc.activate('org-1', 'user-1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('9. activate with invalid graph → BadRequest (graph validation)', async () => {
    const { svc, prisma } = makeService();
    prisma.seed('wf-1', 'DRAFT');
    prisma.get('wf-1').definition = { nodes: [], edges: [] };
    let err: any;
    try { await svc.activate('org-1', 'user-1', 'wf-1'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(BadRequestException);
  });
});
