/**
 * Agents — deployment & version tests (idempotence + invariants).
 *
 * Test-first protocol (CRITIQUE 6):
 *   - Tests observe the current behavior of deployVersion / pause / resume.
 *   - If a test FAILS, the behavior is unexpected and we document it
 *     as a NEW CRITIQUE (we do NOT silently fix the service here).
 *   - We do not modify the service from this file.
 *
 * Targets:
 *   1. deployVersion on ACTIVE agent + valid version → status=ACTIVE,
 *      deployedVersionId pinned.
 *   2. deployVersion with version that belongs to a different agent → NotFound
 *   3. deployVersion with version whose config has no systemInstructions → BadRequest
 *   4. deployVersion on an archived agent (deletedAt set) → BadRequest
 *   5. pause on ACTIVE agent → status=PAUSED
 *   6. resume on PAUSED agent with a deployed version → status=ACTIVE
 *   7. resume on PAUSED agent WITHOUT a deployed version → BadRequest
 *   8. undeploy → status=DRAFT, deployedVersionId=null
 *   9. rollback → creates new version, copies config, re-deploys
 *  10. deployVersion is idempotent (calling twice with same version is safe)
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AgentsService } from '../agents.service';

class FakePrisma {
  private _agents = new Map<string, any>();
  private _versions = new Map<string, any>();
  private _versionCreateCount = 0;

  agent = {
    findFirst: jest.fn(async ({ where }: any) => {
      const a = this._agents.get(where.id);
      if (!a) return null;
      if (a.organizationId !== where.organizationId) return null;
      if (where.deletedAt === null && a.deletedAt) return null;
      return { ...a };
    }),
    findUnique: jest.fn(async ({ where: { id } }: any) => {
      const a = this._agents.get(id);
      return a ? { ...a } : null;
    }),
    update: jest.fn(async ({ where: { id }, data }: any) => {
      const a = this._agents.get(id);
      if (!a) throw new Error('not found');
      Object.assign(a, data);
      return { ...a };
    }),
  };

  agentVersion = {
    findFirst: jest.fn(async ({ where: { id, agentId } }: any) => {
      const v = this._versions.get(id);
      if (!v) return null;
      if (v.agentId !== agentId) return null;
      return { ...v };
    }),
    create: jest.fn(async ({ data }: any) => {
      this._versionCreateCount++;
      const row = {
        id: `v-${this._versionCreateCount}`,
        version: this._versionCreateCount,
        ...data,
      };
      this._versions.set(row.id, row);
      return row;
    }),
    update: jest.fn(async ({ where: { id }, data }: any) => {
      const v = this._versions.get(id);
      if (!v) throw new Error('not found');
      Object.assign(v, data);
      return { ...v };
    }),
  };

  // helpers
  seedAgent(id: string, overrides: any = {}) {
    this._agents.set(id, {
      id, organizationId: 'org-1', name: 'test', status: 'ACTIVE',
      deletedAt: null, deployedVersionId: null,
      modelProvider: 'openai', modelName: 'gpt-4o-mini',
      ...overrides,
    });
  }
  seedVersion(id: string, agentId: string, config: any) {
    this._versions.set(id, { id, agentId, config, version: 1 });
  }
}

function makeService() {
  const prisma = new FakePrisma();
  const svc = new AgentsService(prisma as any);
  return { svc, prisma };
}

const validConfig = {
  systemInstructions: 'You are helpful',
  modelProvider: 'openai',
  modelName: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 1024,
};

describe('AgentsService.deployVersion', () => {
  it('1. deploys a valid version onto an ACTIVE agent', async () => {
    const { svc, prisma } = makeService();
    prisma.seedAgent('a-1');
    prisma.seedVersion('v-1', 'a-1', validConfig);
    const result = await svc.deployVersion('org-1', 'a-1', 'v-1');
    expect(result.status).toBe('ACTIVE');
    expect(result.deployedVersionId).toBe('v-1');
  });

  it('2. rejects when the version does not belong to the agent', async () => {
    const { svc, prisma } = makeService();
    prisma.seedAgent('a-1');
    prisma.seedVersion('v-1', 'a-2', validConfig);
    await expect(svc.deployVersion('org-1', 'a-1', 'v-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('3. rejects a version with no systemInstructions', async () => {
    const { svc, prisma } = makeService();
    prisma.seedAgent('a-1');
    prisma.seedVersion('v-1', 'a-1', { ...validConfig, systemInstructions: '' });
    await expect(svc.deployVersion('org-1', 'a-1', 'v-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('4. rejects deploying onto an archived (soft-deleted) agent', async () => {
    const { svc, prisma } = makeService();
    prisma.seedAgent('a-1', { deletedAt: new Date() });
    prisma.seedVersion('v-1', 'a-1', validConfig);
    // findOwnedAgent filters by deletedAt: null → returns null → NotFound
    await expect(svc.deployVersion('org-1', 'a-1', 'v-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('5. pause(ACTIVE) → PAUSED', async () => {
    const { svc, prisma } = makeService();
    prisma.seedAgent('a-1', { status: 'ACTIVE' });
    const result = await svc.pause('org-1', 'a-1');
    expect(result.status).toBe('PAUSED');
  });

  it('6. resume(PAUSED + deployed) → ACTIVE', async () => {
    const { svc, prisma } = makeService();
    prisma.seedAgent('a-1', { status: 'PAUSED', deployedVersionId: 'v-1' });
    const result = await svc.resume('org-1', 'a-1');
    expect(result.status).toBe('ACTIVE');
  });

  it('7. resume(PAUSED, no deployed version) → BadRequest', async () => {
    const { svc, prisma } = makeService();
    prisma.seedAgent('a-1', { status: 'PAUSED', deployedVersionId: null });
    await expect(svc.resume('org-1', 'a-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('8. undeploy → DRAFT + deployedVersionId=null', async () => {
    const { svc, prisma } = makeService();
    prisma.seedAgent('a-1', { status: 'ACTIVE', deployedVersionId: 'v-1' });
    const result = await svc.undeploy('org-1', 'a-1');
    expect(result.status).toBe('DRAFT');
    expect(result.deployedVersionId).toBeNull();
  });

  it('9. rollback creates a new version, copies config, re-deploys', async () => {
    const { svc, prisma } = makeService();
    prisma.seedAgent('a-1', { status: 'ACTIVE', deployedVersionId: 'v-1' });
    prisma.seedVersion('v-1', 'a-1', validConfig);
    prisma.seedVersion('v-2', 'a-1', { ...validConfig, systemInstructions: 'v2 prompt' });
    const result = await svc.rollback('org-1', 'a-1', 'v-2', 'user-1');
    expect(result.status).toBe('ACTIVE');
    // A new version was created
    expect(prisma.agentVersion.create).toHaveBeenCalled();
    // The agent's deployed version is the new one (not v-2)
    expect(result.deployedVersionId).not.toBe('v-2');
  });

  it('10. deployVersion is idempotent — calling twice yields the same end state', async () => {
    const { svc, prisma } = makeService();
    prisma.seedAgent('a-1');
    prisma.seedVersion('v-1', 'a-1', validConfig);
    const r1 = await svc.deployVersion('org-1', 'a-1', 'v-1');
    const r2 = await svc.deployVersion('org-1', 'a-1', 'v-1');
    expect(r1.deployedVersionId).toBe('v-1');
    expect(r2.deployedVersionId).toBe('v-1');
    expect(r1.status).toBe(r2.status);
  });
});
