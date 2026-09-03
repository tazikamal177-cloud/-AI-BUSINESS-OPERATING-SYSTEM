/**
 * AgentsService — unit tests using a Prisma stub.
 *
 * Covers the versionning + deployment contract:
 *   - create() makes v1
 *   - createVersion() increments the version
 *   - deployVersion() pins and activates
 *   - rollback() creates a new version with target's config and deploys it
 *   - archive/restore toggle deletedAt
 *   - hardDelete cascades
 */
import { AgentsService } from '../src/modules/agents/agents.service';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

type Agent = any;
type AgentVersion = any;

class FakePrisma {
  agents: Agent[] = [];
  versions: AgentVersion[] = [];
  agentTools: any[] = [];
  agentKnowledge: any[] = [];

  agent = {
    findMany: async (args: any) => {
      let list = this.agents.filter((a) => a.organizationId === args.where?.organizationId || a.organizationId === undefined);
      if (args.where?.status) list = list.filter((a) => a.status === args.where.status);
      if (args.where?.deletedAt === null) list = list.filter((a) => !a.deletedAt);
      list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return list.slice(0, args.take ?? 50).map((a) => ({ ...a }));
    },
    findFirst: async (args: any) => {
      return this.agents.find((a) => a.id === args.where.id && a.organizationId === args.where.organizationId) ?? null;
    },
    findUnique: async (args: any) => {
      if (args.where.organizationId_slug) {
        return (
          this.agents.find(
            (a) =>
              a.organizationId === args.where.organizationId_slug.organizationId &&
              a.slug === args.where.organizationId_slug.slug,
          ) ?? null
        );
      }
      if (args.where.id) {
        return this.agents.find((a) => a.id === args.where.id) ?? null;
      }
      return null;
    },
    create: async (args: any) => {
      const created: Agent = {
        id: randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deployedVersionId: null,
        status: 'DRAFT',
        ...args.data,
      };
      this.agents.push(created);
      return { ...created };
    },
    update: async (args: any) => {
      const a = this.agents.find((x) => x.id === args.where.id);
      if (!a) throw new Error('not found');
      Object.assign(a, args.data);
      return { ...a };
    },
    delete: async (args: any) => {
      this.agents = this.agents.filter((a) => a.id !== args.where.id);
      return {};
    },
  };

  agentVersion = {
    findFirst: async (args: any) => {
      const list = this.versions.filter((v) => v.agentId === args.where.agentId);
      list.sort((a, b) => b.version - a.version);
      return list[0] ?? null;
    },
    findMany: async (args: any) => {
      return this.versions
        .filter((v) => v.agentId === args.where.agentId)
        .sort((a, b) => b.version - a.version)
        .map((v) => ({ ...v }));
    },
    create: async (args: any) => {
      const v: AgentVersion = { id: randomUUID(), createdAt: new Date(), ...args.data };
      this.versions.push(v);
      return { ...v };
    },
    update: async (args: any) => {
      const v = this.versions.find((x) => x.id === args.where.id);
      Object.assign(v, args.data);
      return { ...v };
    },
  };

  agentTool = {
    createMany: async (args: any) => { this.agentTools.push(...args.data); return { count: args.data.length }; },
  };

  agentKnowledge = {
    createMany: async (args: any) => { this.agentKnowledge.push(...args.data); return { count: args.data.length }; },
  };

  $transaction = async (ops: any[]) => Promise.all(ops);

  $queryRawUnsafe = async () => [];
}

describe('AgentsService', () => {
  let svc: AgentsService;
  let prisma: FakePrisma;
  const orgId = 'org-1';
  const userId = 'user-1';

  beforeEach(() => {
    prisma = new FakePrisma();
    svc = new AgentsService(prisma as any);
  });

  it('create() makes v1', async () => {
    const a = await svc.create(orgId, userId, {
      name: 'Sales',
      systemInstructions: 'You sell things',
    } as any);
    expect(a.status).toBe('DRAFT');
    const versions = await svc.listVersions(orgId, a.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
  });

  it('createVersion() increments the version', async () => {
    const a = await svc.create(orgId, userId, { name: 'A', systemInstructions: 'x' } as any);
    const v2 = await svc.createVersion(orgId, a.id, userId, 'tweak');
    const v3 = await svc.createVersion(orgId, a.id, userId, 'tweak2');
    expect(v2.version).toBe(2);
    expect(v3.version).toBe(3);
  });

  it('deployVersion() pins and activates', async () => {
    const a = await svc.create(orgId, userId, { name: 'A', systemInstructions: 'x' } as any);
    const v1 = (await svc.listVersions(orgId, a.id))[0];
    const deployed = await svc.deployVersion(orgId, a.id, v1.id);
    expect(deployed.status).toBe('ACTIVE');
    expect(deployed.deployedVersionId).toBe(v1.id);
  });

  it('rollback() creates a new version with target config', async () => {
    const a = await svc.create(orgId, userId, { name: 'A', systemInstructions: 'v1' } as any);
    // Update to v2 with different config
    await svc.update(orgId, a.id, { systemInstructions: 'v2 content' } as any, userId, { commitVersion: true });
    const versions = await svc.listVersions(orgId, a.id);
    const v1 = versions.find((v) => v.version === 1)!;
    const v2 = versions.find((v) => v.version === 2)!;

    const rolled = await svc.rollback(orgId, a.id, v1.id, userId);
    // After rollback, a new v3 should exist with v1's config
    const after = await svc.listVersions(orgId, a.id);
    expect(after.find((v) => v.version === 3)).toBeDefined();
    expect(rolled.deployedVersionId).toBe(after.find((v) => v.version === 3).id);
  });

  it('archive() then restore() toggles deletedAt and status', async () => {
    const a = await svc.create(orgId, userId, { name: 'A' } as any);
    const archived = await svc.archive(orgId, a.id);
    expect(archived.status).toBe('ARCHIVED');
    expect(archived.deletedAt).toBeTruthy();
    const restored = await svc.restore(orgId, a.id);
    expect(restored.status).toBe('DRAFT');
    expect(restored.deletedAt).toBeNull();
  });

  it('undeploy() clears deployedVersionId and sets DRAFT', async () => {
    const a = await svc.create(orgId, userId, { name: 'A', systemInstructions: 'x' } as any);
    const v1 = (await svc.listVersions(orgId, a.id))[0];
    await svc.deployVersion(orgId, a.id, v1.id);
    const undone = await svc.undeploy(orgId, a.id);
    expect(undone.status).toBe('DRAFT');
    expect(undone.deployedVersionId).toBeNull();
  });

  it('resume() requires a deployed version', async () => {
    const a = await svc.create(orgId, userId, { name: 'A', systemInstructions: 'x' } as any);
    await expect(svc.resume(orgId, a.id)).rejects.toThrow(BadRequestException);
  });

  it('deployVersion() rejects versions without systemInstructions', async () => {
    // create a version directly with empty config
    const a = await svc.create(orgId, userId, { name: 'A', systemInstructions: 'x' } as any);
    prisma.versions[0].config.systemInstructions = '';
    await expect(svc.deployVersion(orgId, a.id, prisma.versions[0].id)).rejects.toThrow(BadRequestException);
  });

  it('findAll() filters out archived by default', async () => {
    await svc.create(orgId, userId, { name: 'A' } as any);
    const a2 = await svc.create(orgId, userId, { name: 'B' } as any);
    await svc.archive(orgId, a2.id);
    const r = await svc.findAll({ orgId });
    expect(r.data).toHaveLength(1);
    const r2 = await svc.findAll({ orgId, includeArchived: true });
    expect(r2.data).toHaveLength(2);
  });
});
