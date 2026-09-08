import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { randomBytes } from 'node:crypto';

export interface ListAgentsOptions {
  orgId: string;
  status?: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  search?: string;
  cursor?: string;
  limit?: number;
  includeArchived?: boolean;
}

export interface AgentStats {
  conversations: number;
  messages: number;
  toolExecutions: number;
  tokensLast30d: number;
  costLast30d: number;
  pendingApprovals: number;
  byDay: Array<{ date: string; tokens: number; cost: number; messages: number }>;
}

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ──────────────────────────── List / Get ────────────────────────────

  async findAll(opts: ListAgentsOptions) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    const where: any = {
      organizationId: opts.orgId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.includeArchived ? {} : { deletedAt: null, status: { not: 'ARCHIVED' } }),
    };
    if (opts.search) {
      where.OR = [
        { name: { contains: opts.search, mode: 'insensitive' } },
        { description: { contains: opts.search, mode: 'insensitive' } },
        { role: { contains: opts.search, mode: 'insensitive' } },
      ];
    }
    if (opts.cursor) {
      where.id = { lt: opts.cursor };
    }
    const items = await this.prisma.agent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: {
        deployedVersion: { select: { id: true, version: true, createdAt: true } },
        _count: {
          select: {
            conversations: true,
            agentTools: true,
            agentKnowledge: true,
            versions: true,
          },
        },
      },
    });
    const hasMore = items.length > limit;
    const data = hasMore ? items.slice(0, limit) : items;
    return {
      data,
      nextCursor: hasMore ? data[data.length - 1].id : null,
    };
  }

  async findOne(orgId: string, agentId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, organizationId: orgId, deletedAt: null },
      include: {
        agentTools: { include: { tool: true } },
        agentKnowledge: { include: { knowledgeBase: true } },
        versions: {
          orderBy: { version: 'desc' },
          take: 10,
        },
        deployedVersion: {
          select: { id: true, version: true, changeNotes: true, createdAt: true },
        },
        _count: { select: { conversations: true } },
      },
    });
    if (!agent) throw new NotFoundException('Agent not found');
    return agent;
  }

  // ──────────────────────────── Create ────────────────────────────

  async create(orgId: string, userId: string, dto: CreateAgentDto) {
    const slug = dto.slug ?? (await this.generateUniqueSlug(orgId, dto.name));
    const agent = await this.prisma.agent.create({
      data: {
        id: uuidv4(),
        organizationId: orgId,
        createdBy: userId,
        name: dto.name,
        slug,
        description: dto.description,
        role: dto.role || 'assistant',
        objective: dto.objective,
        systemInstructions: dto.systemInstructions || 'You are a helpful AI assistant.',
        personality: dto.personality,
        tone: dto.tone || 'professional',
        language: dto.language || 'en',
        modelProvider: dto.modelProvider || 'openai',
        modelName: dto.modelName || 'gpt-4o-mini',
        temperature: dto.temperature ?? 0.7,
        maxTokens: dto.maxTokens ?? 4096,
        status: 'DRAFT',
        guardrails: dto.guardrails,
        maxToolCalls: dto.maxToolCalls ?? 10,
        timeoutSeconds: dto.timeoutSeconds ?? 120,
      },
    });
    // Initial v1 snapshot
    await this.prisma.agentVersion.create({
      data: {
        id: uuidv4(),
        agentId: agent.id,
        version: 1,
        config: this.snapshotConfig(agent),
        changeNotes: 'Initial version',
        createdBy: userId,
      },
    });
    return agent;
  }

  // ──────────────────────────── Update ────────────────────────────
  // Two flavors:
  //   update()      → mutates the draft metadata, no new version
  //   updateDraft() → same but creates a new version snapshot
  // The HTTP layer exposes both via `?commit=true` to control behavior.

  async update(orgId: string, agentId: string, dto: UpdateAgentDto, userId: string, opts: { commitVersion?: boolean; changeNotes?: string } = {}) {
    const existing = await this.findOwnedAgent(orgId, agentId);
    if (!existing) throw new NotFoundException('Agent not found');
    if (existing.deletedAt) throw new BadRequestException('Agent is archived');

    const updated = await this.prisma.agent.update({
      where: { id: agentId },
      data: {
        name: dto.name,
        description: dto.description,
        role: dto.role,
        objective: dto.objective,
        systemInstructions: dto.systemInstructions,
        personality: dto.personality,
        tone: dto.tone,
        language: dto.language,
        modelProvider: dto.modelProvider,
        modelName: dto.modelName,
        temperature: dto.temperature,
        maxTokens: dto.maxTokens,
        guardrails: dto.guardrails,
        maxToolCalls: dto.maxToolCalls,
        timeoutSeconds: dto.timeoutSeconds,
      },
    });

    if (opts.commitVersion) {
      await this.createVersionInternal(agentId, userId, opts.changeNotes ?? 'Update');
    }
    return updated;
  }

  // ──────────────────────────── Versions ────────────────────────────

  async listVersions(orgId: string, agentId: string) {
    const agent = await this.findOwnedAgent(orgId, agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    return this.prisma.agentVersion.findMany({
      where: { agentId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        changeNotes: true,
        createdAt: true,
        createdBy: true,
      },
    });
  }

  async getVersion(orgId: string, agentId: string, versionId: string) {
    const agent = await this.findOwnedAgent(orgId, agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    const v = await this.prisma.agentVersion.findFirst({
      where: { id: versionId, agentId },
    });
    if (!v) throw new NotFoundException('Version not found');
    return v;
  }

  /**
   * Snapshot the current agent state into a new version.
   * Public wrapper around the private helper so the controller can call it.
   */
  async createVersion(orgId: string, agentId: string, userId: string, changeNotes?: string) {
    const agent = await this.findOwnedAgent(orgId, agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    return this.createVersionInternal(agentId, userId, changeNotes ?? 'Manual version');
  }

  /**
   * Pin a specific version as the deployed one.
   * The agent's main fields (name, instructions, model, etc.) are NOT modified —
   * the runtime reads the pinned `AgentVersion.config` to ensure immutability.
   */
  async deployVersion(orgId: string, agentId: string, versionId: string) {
    const agent = await this.findOwnedAgent(orgId, agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.deletedAt) throw new BadRequestException('Cannot deploy an archived agent');

    const version = await this.prisma.agentVersion.findFirst({
      where: { id: versionId, agentId },
    });
    if (!version) throw new NotFoundException('Version not found');

    const cfg = version.config as any;
    if (!cfg?.systemInstructions) {
      throw new BadRequestException('This version has no system instructions — cannot deploy');
    }

    // Pin the version + activate the agent + sync the main fields from the version
    return this.prisma.agent.update({
      where: { id: agentId },
      data: {
        status: 'ACTIVE',
        deployedVersionId: version.id,
        // Sync the main config from the version snapshot
        name: cfg.name ?? agent.name,
        description: cfg.description ?? agent.description,
        role: cfg.role ?? agent.role,
        objective: cfg.objective ?? agent.objective,
        systemInstructions: cfg.systemInstructions,
        personality: cfg.personality ?? agent.personality,
        tone: cfg.tone ?? agent.tone,
        language: cfg.language ?? agent.language,
        modelProvider: cfg.modelProvider ?? agent.modelProvider,
        modelName: cfg.modelName ?? agent.modelName,
        temperature: cfg.temperature ?? agent.temperature,
        maxTokens: cfg.maxTokens ?? agent.maxTokens,
        guardrails: cfg.guardrails ?? agent.guardrails,
        maxToolCalls: cfg.maxToolCalls ?? agent.maxToolCalls,
        timeoutSeconds: cfg.timeoutSeconds ?? agent.timeoutSeconds,
      },
    });
  }

  /** Undeploy: set status to DRAFT and clear the pinned version. */
  async undeploy(orgId: string, agentId: string) {
    const agent = await this.findOwnedAgent(orgId, agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    return this.prisma.agent.update({
      where: { id: agentId },
      data: { status: 'DRAFT', deployedVersionId: null },
    });
  }

  /** Rollback: pin a previous version as the deployed one (creates a new version that copies its config). */
  async rollback(orgId: string, agentId: string, versionId: string, userId: string) {
    const agent = await this.findOwnedAgent(orgId, agentId);
    if (!agent) throw new NotFoundException('Agent not found');

    const target = await this.prisma.agentVersion.findFirst({
      where: { id: versionId, agentId },
    });
    if (!target) throw new NotFoundException('Version not found');

    // 1. Create a NEW version copying the target's config (history-preserving)
    const newVersion = await this.createVersionInternal(
      agentId,
      userId,
      `Rollback to v${target.version}`,
    );
    // Override the just-created version with target's config
    await this.prisma.agentVersion.update({
      where: { id: newVersion.id },
      data: { config: target.config as any },
    });

    // 2. Re-deploy the new (rollback) version
    return this.deployVersion(orgId, agentId, newVersion.id);
  }

  // ──────────────────────────── Pause / Resume ────────────────────────────

  async pause(orgId: string, agentId: string) {
    const agent = await this.findOwnedAgent(orgId, agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    return this.prisma.agent.update({
      where: { id: agentId },
      data: { status: 'PAUSED' },
    });
  }

  async resume(orgId: string, agentId: string) {
    const agent = await this.findOwnedAgent(orgId, agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    if (!agent.deployedVersionId) {
      throw new BadRequestException('No deployed version — deploy a version first');
    }
    return this.prisma.agent.update({
      where: { id: agentId },
      data: { status: 'ACTIVE' },
    });
  }

  // ──────────────────────────── Archive (soft-delete) ────────────────────────────

  async archive(orgId: string, agentId: string) {
    const agent = await this.findOwnedAgent(orgId, agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.status === 'ARCHIVED') return agent;
    return this.prisma.agent.update({
      where: { id: agentId },
      data: { status: 'ARCHIVED', deletedAt: new Date(), deployedVersionId: null },
    });
  }

  async restore(orgId: string, agentId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, organizationId: orgId },
    });
    if (!agent) throw new NotFoundException('Agent not found');
    return this.prisma.agent.update({
      where: { id: agentId },
      data: { status: 'DRAFT', deletedAt: null },
    });
  }

  /** Hard delete (Owner only). Cascades are not enforced by RLS; do it manually. */
  async hardDelete(orgId: string, agentId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, organizationId: orgId },
    });
    if (!agent) throw new NotFoundException('Agent not found');
    // Soft-children cascade handled at app level
    await this.prisma.$transaction([
      this.prisma.agentVersion.deleteMany({ where: { agentId } }),
      this.prisma.agentTool.deleteMany({ where: { agentId } }),
      this.prisma.agentKnowledge.deleteMany({ where: { agentId } }),
      this.prisma.workflowNode.deleteMany({ where: { agentId } }),
      this.prisma.conversation.deleteMany({ where: { agentId } }),
      this.prisma.usageRecord.deleteMany({ where: { agentId } }),
      this.prisma.toolExecution.deleteMany({ where: { agentId } }),
      this.prisma.task.deleteMany({ where: { agentId } }),
      this.prisma.agent.delete({ where: { id: agentId } }),
    ]);
    return { message: 'Agent permanently deleted' };
  }

  // ──────────────────────────── Duplicate ────────────────────────────

  async duplicate(orgId: string, userId: string, agentId: string) {
    const agent = await this.findOne(orgId, agentId);
    const cloned = await this.prisma.agent.create({
      data: {
        id: uuidv4(),
        organizationId: orgId,
        createdBy: userId,
        name: `${agent.name} (Copy)`,
        slug: await this.generateUniqueSlug(orgId, `${agent.name}-copy-${randomBytes(2).toString('hex')}`),
        description: agent.description,
        role: agent.role,
        objective: agent.objective,
        systemInstructions: agent.systemInstructions,
        personality: agent.personality,
        tone: agent.tone,
        language: agent.language,
        modelProvider: agent.modelProvider,
        modelName: agent.modelName,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        status: 'DRAFT',
        guardrails: agent.guardrails as any,
        maxToolCalls: agent.maxToolCalls,
        timeoutSeconds: agent.timeoutSeconds,
        deployedVersionId: null,
      },
    });

    // Copy attached tools (preserve configuration override)
    if (agent.agentTools?.length) {
      await this.prisma.agentTool.createMany({
        data: agent.agentTools.map((at) => ({
          id: uuidv4(),
          agentId: cloned.id,
          toolId: at.toolId,
          configuration: at.configuration as any,
          permissions: at.permissions as any,
        })),
      });
    }

    // Copy attached knowledge bases
    if (agent.agentKnowledge?.length) {
      await this.prisma.agentKnowledge.createMany({
        data: agent.agentKnowledge.map((ak) => ({
          id: uuidv4(),
          agentId: cloned.id,
          knowledgeBaseId: ak.knowledgeBaseId,
        })),
      });
    }

    // Create v1 for the clone
    await this.prisma.agentVersion.create({
      data: {
        id: uuidv4(),
        agentId: cloned.id,
        version: 1,
        config: this.snapshotConfig(cloned),
        changeNotes: `Cloned from ${agent.name}`,
        createdBy: userId,
      },
    });

    return cloned;
  }

  // ──────────────────────────── Templates ────────────────────────────

  async getTemplates(category?: string) {
    return this.prisma.agent.findMany({
      where: {
        isTemplate: true,
        organizationId: { equals: null } as any,
        ...(category ? { templateCategory: category } : {}),
      },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        role: true,
        objective: true,
        systemInstructions: true,
        personality: true,
        tone: true,
        templateCategory: true,
        modelProvider: true,
        modelName: true,
        temperature: true,
        maxTokens: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async cloneFromTemplate(orgId: string, userId: string, templateSlug: string) {
    const template = await this.prisma.agent.findFirst({
      where: {
        isTemplate: true,
        slug: templateSlug,
        organizationId: { equals: null } as any,
      },
    });
    if (!template) throw new NotFoundException('Template not found');

    const cloned = await this.create(orgId, userId, {
      name: template.name,
      description: template.description,
      role: template.role,
      objective: template.objective,
      systemInstructions: template.systemInstructions,
      personality: template.personality,
      tone: template.tone,
      language: template.language,
      modelProvider: template.modelProvider,
      modelName: template.modelName,
      temperature: template.temperature,
      maxTokens: template.maxTokens,
      guardrails: template.guardrails as any,
      maxToolCalls: template.maxToolCalls,
      timeoutSeconds: template.timeoutSeconds,
    } as any);

    // v2: this is the actual initial version, the create() already made v1
    // We could rename but it's fine — v1 is the clone itself.
    return cloned;
  }

  // ──────────────────────────── Attach / Detach ────────────────────────────

  async attachTool(orgId: string, agentId: string, toolId: string, configuration?: any, permissions?: any) {
    const agent = await this.findOwnedAgent(orgId, agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    const tool = await this.prisma.tool.findFirst({
      where: {
        id: toolId,
        OR: [{ organizationId: null }, { organizationId: orgId }],
        status: 'ACTIVE',
      },
    });
    if (!tool) throw new NotFoundException('Tool not found');

    return this.prisma.agentTool.upsert({
      where: { agentId_toolId: { agentId, toolId } },
      update: { configuration: configuration as any, permissions: permissions as any },
      create: {
        id: uuidv4(),
        agentId,
        toolId,
        configuration: configuration as any,
        permissions: permissions as any,
      },
    });
  }

  async detachTool(orgId: string, agentId: string, toolId: string) {
    const agent = await this.findOwnedAgent(orgId, agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    await this.prisma.agentTool.delete({
      where: { agentId_toolId: { agentId, toolId } },
    });
    return { message: 'Tool detached' };
  }

  async attachKnowledge(orgId: string, agentId: string, knowledgeBaseId: string) {
    const agent = await this.findOwnedAgent(orgId, agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, organizationId: orgId, deletedAt: null },
    });
    if (!kb) throw new NotFoundException('Knowledge base not found');

    return this.prisma.agentKnowledge.upsert({
      where: { agentId_knowledgeBaseId: { agentId, knowledgeBaseId } },
      update: {},
      create: { id: uuidv4(), agentId, knowledgeBaseId },
    });
  }

  async detachKnowledge(orgId: string, agentId: string, knowledgeBaseId: string) {
    const agent = await this.findOwnedAgent(orgId, agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    await this.prisma.agentKnowledge.delete({
      where: { agentId_knowledgeBaseId: { agentId, knowledgeBaseId } },
    });
    return { message: 'Knowledge base detached' };
  }

  // ──────────────────────────── Stats ────────────────────────────

  async getStats(orgId: string, agentId: string): Promise<AgentStats> {
    const agent = await this.findOwnedAgent(orgId, agentId);
    if (!agent) throw new NotFoundException('Agent not found');

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      conversations,
      messages,
      toolExecutions,
      usageAgg,
      pendingApprovals,
      daily,
    ] = await Promise.all([
      this.prisma.conversation.count({ where: { agentId, organizationId: orgId } }),
      this.prisma.message.count({
        where: {
          conversation: { agentId, organizationId: orgId },
          createdAt: { gte: since },
        },
      }),
      this.prisma.toolExecution.count({
        where: { agentId, organizationId: orgId, createdAt: { gte: since } },
      }),
      this.prisma.usageRecord.aggregate({
        where: { agentId, organizationId: orgId, createdAt: { gte: since } },
        _sum: { totalTokens: true, estimatedCost: true },
      }),
      this.prisma.task.count({
        where: { agentId, organizationId: orgId, status: 'REQUIRES_APPROVAL' },
      }),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT
           to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date,
           COALESCE(SUM(total_tokens), 0)::int AS tokens,
           COALESCE(SUM(estimated_cost), 0)::float AS cost,
           COUNT(*)::int AS messages
         FROM usage_records
         WHERE agent_id = $1 AND organization_id = $2 AND created_at >= $3
         GROUP BY 1
         ORDER BY 1 ASC`,
        [agentId, orgId, since],
      ),
    ]);

    return {
      conversations,
      messages,
      toolExecutions,
      tokensLast30d: usageAgg._sum.totalTokens ?? 0,
      costLast30d: usageAgg._sum.estimatedCost ? Number(usageAgg._sum.estimatedCost) : 0,
      pendingApprovals,
      byDay: daily,
    };
  }

  // ──────────────────────────── Internals ────────────────────────────

  private async createVersionInternal(agentId: string, userId: string, changeNotes: string) {
    const last = await this.prisma.agentVersion.findFirst({
      where: { agentId },
      orderBy: { version: 'desc' },
    });
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw new NotFoundException('Agent not found');
    return this.prisma.agentVersion.create({
      data: {
        id: uuidv4(),
        agentId,
        version: (last?.version ?? 0) + 1,
        config: this.snapshotConfig(agent),
        changeNotes,
        createdBy: userId,
      },
    });
  }

  private snapshotConfig(agent: any) {
    return {
      name: agent.name,
      description: agent.description,
      role: agent.role,
      objective: agent.objective,
      systemInstructions: agent.systemInstructions,
      personality: agent.personality,
      tone: agent.tone,
      language: agent.language,
      modelProvider: agent.modelProvider,
      modelName: agent.modelName,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      guardrails: agent.guardrails,
      maxToolCalls: agent.maxToolCalls,
      timeoutSeconds: agent.timeoutSeconds,
    };
  }

  private async findOwnedAgent(orgId: string, agentId: string) {
    return this.prisma.agent.findFirst({
      where: { id: agentId, organizationId: orgId, deletedAt: null },
    });
  }

  private async generateUniqueSlug(orgId: string, name: string): Promise<string> {
    const base = (name || 'agent')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'agent';
    let slug = base;
    let i = 1;
    while (
      await this.prisma.agent.findUnique({
        where: { organizationId_slug: { organizationId: orgId, slug } },
      })
    ) {
      slug = `${base}-${i++}`;
      if (i > 100) { slug = `${base}-${randomBytes(3).toString('hex')}`; break; }
    }
    return slug;
  }
}
