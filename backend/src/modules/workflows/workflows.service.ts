import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { assertValidGraph, validateGraph } from './engine/graph.validation';
import { WorkflowGraph } from './engine/graph.types';
import { WorkflowRunner } from './engine/workflow-runner';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class WorkflowsService {
  private readonly logger = new Logger(WorkflowsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: WorkflowRunner,
    private readonly audit: AuditService,
  ) {}

  // ──────────────────────────── CRUD ────────────────────────────

  list(orgId: string) {
    return this.prisma.workflow.findMany({
      where: { organizationId: orgId, deletedAt: null },
      include: { _count: { select: { nodes: true, runs: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(orgId: string, workflowId: string) {
    const w = await this.prisma.workflow.findFirst({
      where: { id: workflowId, organizationId: orgId, deletedAt: null },
      include: {
        nodes: true,
        edges: true,
        runs: { orderBy: { startedAt: 'desc' }, take: 10 },
      },
    });
    if (!w) throw new NotFoundException('Workflow not found');
    return w;
  }

  async create(orgId: string, userId: string, dto: CreateWorkflowDto) {
    const definition: WorkflowGraph = (dto.definition as any) ?? { nodes: dto.nodes ?? [], edges: dto.edges ?? [] };
    assertValidGraph(definition);

    const workflow = await this.prisma.workflow.create({
      data: {
        organizationId: orgId,
        createdBy: userId,
        name: dto.name,
        description: dto.description,
        trigger: dto.trigger as any,
        triggerConfig: dto.triggerConfig as any,
        definition: definition as any,
        status: 'DRAFT',
      },
    });
    await this.persistGraph(workflow.id, definition);
    await this.audit.log({
      organizationId: orgId, userId, action: 'workflow.create',
      resourceType: 'workflow', resourceId: workflow.id,
      metadata: { name: workflow.name, nodes: definition.nodes.length, edges: definition.edges.length },
    });
    return this.get(orgId, workflow.id);
  }

  async update(orgId: string, userId: string, workflowId: string, dto: UpdateWorkflowDto) {
    const w = await this.get(orgId, workflowId);
    if (dto.definition) {
      const r = validateGraph(dto.definition as any);
      if (!r.ok) throw new BadRequestException({ code: 'INVALID_GRAPH', errors: r.errors });
      await this.persistGraph(w.id, dto.definition as any);
    }
    const updated = await this.prisma.workflow.update({
      where: { id: w.id },
      data: {
        name: dto.name,
        description: dto.description,
        trigger: dto.trigger as any,
        triggerConfig: dto.triggerConfig as any,
        definition: (dto.definition as any) ?? undefined,
        status: dto.status as any,
        version: dto.definition ? { increment: 1 } : undefined,
      },
    });
    await this.audit.log({
      organizationId: orgId, userId, action: 'workflow.update',
      resourceType: 'workflow', resourceId: w.id,
      metadata: { name: updated.name, version: updated.version },
    });
    return this.get(orgId, w.id);
  }

  async activate(orgId: string, userId: string, workflowId: string) {
    const w = await this.get(orgId, workflowId);
    if (w.status === 'ARCHIVED' || (w as any).deletedAt) {
      throw new BadRequestException({ code: 'WORKFLOW_ARCHIVED', message: 'Cannot activate an archived workflow' });
    }
    const r = validateGraph(w.definition as any);
    if (!r.ok) throw new BadRequestException({ code: 'INVALID_GRAPH', errors: r.errors });
    const updated = await this.prisma.workflow.update({
      where: { id: w.id },
      data: { status: 'ACTIVE' as any },
    });
    await this.audit.log({
      organizationId: orgId, userId, action: 'workflow.activate',
      resourceType: 'workflow', resourceId: w.id,
    });
    return updated;
  }

  async pause(orgId: string, userId: string, workflowId: string) {
    const w = await this.get(orgId, workflowId);
    if (w.status === 'ARCHIVED' || (w as any).deletedAt) {
      throw new BadRequestException({ code: 'WORKFLOW_ARCHIVED', message: 'Cannot pause an archived workflow' });
    }
    const updated = await this.prisma.workflow.update({ where: { id: w.id }, data: { status: 'PAUSED' as any } });
    await this.audit.log({ organizationId: orgId, userId, action: 'workflow.pause', resourceType: 'workflow', resourceId: w.id });
    return updated;
  }

  async archive(orgId: string, userId: string, workflowId: string) {
    const w = await this.get(orgId, workflowId);
    await this.prisma.workflow.update({ where: { id: w.id }, data: { deletedAt: new Date(), status: 'ARCHIVED' as any } });
    await this.audit.log({ organizationId: orgId, userId, action: 'workflow.archive', resourceType: 'workflow', resourceId: w.id });
    return { ok: true };
  }

  // ──────────────────────────── Runs ────────────────────────────

  async runWorkflow(orgId: string, userId: string | undefined, workflowId: string, triggerData: Record<string, unknown> = {}) {
    const w = await this.get(orgId, workflowId);
    if (w.status !== 'ACTIVE') {
      throw new BadRequestException('Workflow must be ACTIVE to run');
    }
    const run = await this.prisma.workflowRun.create({
      data: {
        organizationId: orgId,
        workflowId: w.id,
        workflowVersion: w.version,
        status: 'PENDING' as any,
        triggerData: triggerData as any,
        snapshot: w.definition as any,
      },
    });
    // Fire-and-forget; the runner resolves its own promise.
    this.runner.run(w.id, run.id, {
      organizationId: orgId,
      userId,
      trigger: triggerData,
      snapshot: w.definition as any,
    }).catch((e) => this.logger.error(`Run ${run.id} failed: ${e?.message}`));
    return run;
  }

  async getRun(orgId: string, runId: string) {
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: runId, organizationId: orgId },
      include: { logs: { orderBy: { createdAt: 'asc' } } },
    });
    if (!run) throw new NotFoundException('Run not found');
    return run;
  }

  listRuns(orgId: string, workflowId: string) {
    return this.prisma.workflowRun.findMany({
      where: { workflowId, organizationId: orgId },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
  }

  async cancelRun(orgId: string, runId: string) {
    const run = await this.prisma.workflowRun.findFirst({ where: { id: runId, organizationId: orgId } });
    if (!run) throw new NotFoundException('Run not found');
    if (run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELLED') {
      return run;
    }
    return this.prisma.workflowRun.update({
      where: { id: runId },
      data: { status: 'CANCELLED' as any, completedAt: new Date() },
    });
  }

  // ──────────────────────────── helpers ────────────────────────────

  private async persistGraph(workflowId: string, graph: WorkflowGraph) {
    await this.prisma.$transaction([
      this.prisma.workflowEdge.deleteMany({ where: { workflowId } }),
      this.prisma.workflowNode.deleteMany({ where: { workflowId } }),
    ]);
    if (graph.nodes.length) {
      await this.prisma.workflowNode.createMany({
        data: graph.nodes.map((n) => ({
          id: n.id,
          workflowId,
          type: n.type as any,
          name: n.name,
          agentId: n.agentId,
          configuration: (n.configuration ?? {}) as any,
          positionX: n.positionX ?? 0,
          positionY: n.positionY ?? 0,
        })),
      });
    }
    if (graph.edges.length) {
      await this.prisma.workflowEdge.createMany({
        data: graph.edges.map((e) => ({
          id: e.id,
          workflowId,
          sourceNodeId: e.sourceNodeId,
          targetNodeId: e.targetNodeId,
          condition: (e.condition ?? null) as any,
          label: e.label,
        })),
      });
    }
  }
}
