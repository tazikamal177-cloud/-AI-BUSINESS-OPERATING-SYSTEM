import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { randomUUID } from 'node:crypto';
import { NodeHandler } from './handlers/node-handler.interface';
import { TriggerHandler } from './handlers/trigger.handler';
import { EndHandler } from './handlers/end.handler';
import { WaitHandler } from './handlers/wait.handler';
import { AgentNodeHandler } from './handlers/agent.handler';
import { ActionNodeHandler } from './handlers/action.handler';
import { ConditionHandler } from './handlers/condition.handler';
import { ParallelHandler } from './handlers/parallel.handler';
import { WorkflowGraph, WorkflowNode, WorkflowEdge, WorkflowRunContext, NodeExecutionResult } from './graph.types';
import { getNode, getOutgoingEdges } from './graph.validation';
import { evaluateEdgeCondition } from './graph.conditions';

export interface RunOptions {
  organizationId: string;
  userId?: string;
  trigger: Record<string, unknown>;
  /** Pre-snapshot definition (run.snapshot), in case the workflow was edited mid-run. */
  snapshot?: WorkflowGraph;
}

/**
 * WorkflowRunner — depth-first graph executor.
 *
 * Algorithm:
 *   1. Resolve handlers by node type.
 *   2. Start from the unique TRIGGER node.
 *   3. Execute handler → merge setVars into run context → write log row.
 *   4. If node is END → stop.
 *   5. Else evaluate each outgoing edge's condition. Take all matching edges
 *      (in declaration order). If none match, stop.
 *   6. For PARALLEL edges, fork the run: spawn parallel executions and
 *      continue when all branches reach a join point.
 *
 * Retry policy:
 *   - Each handler may return `{ ok: false, error }` to mark the run FAILED.
 *   - Per-handler retry is the handler's responsibility (e.g. ActionHandler).
 */
@Injectable()
export class WorkflowRunner implements OnModuleInit {
  private readonly logger = new Logger(WorkflowRunner.name);
  private handlers = new Map<string, NodeHandler>();

  constructor(
    private readonly prisma: PrismaService,
    trigger: TriggerHandler,
    end: EndHandler,
    wait: WaitHandler,
    agent: AgentNodeHandler,
    action: ActionNodeHandler,
    condition: ConditionHandler,
    parallel: ParallelHandler,
  ) {
    [
      [trigger, 'TRIGGER'],
      [end, 'END'],
      [wait, 'WAIT'],
      [agent, 'AGENT'],
      [action, 'ACTION'],
      [condition, 'CONDITION'],
      [parallel, 'PARALLEL'],
    ].forEach(([h, type]) => this.handlers.set(type as string, h as NodeHandler));
  }

  onModuleInit() {
    this.logger.log(`Workflow handlers registered: ${Array.from(this.handlers.keys()).join(', ')}`);
  }

  /**
   * Run a workflow to completion. Returns when the graph is done or fails.
   */
  async run(workflowId: string, runId: string, opts: RunOptions): Promise<void> {
    const run = await this.prisma.workflowRun.findUnique({ where: { id: runId } });
    if (!run) throw new Error(`Run ${runId} not found`);
    const graph = (run.snapshot as unknown as WorkflowGraph) ?? opts.snapshot;
    if (!graph) throw new Error('Run has no graph snapshot');

    const ctx: WorkflowRunContext = {
      runId,
      organizationId: opts.organizationId,
      userId: opts.userId,
      trigger: opts.trigger,
      vars: (run.context as any) ?? {},
      step: 0,
    };

    const triggerNode = graph.nodes.find((n) => n.type === 'TRIGGER');
    if (!triggerNode) {
      await this.fail(runId, 'No TRIGGER node found');
      return;
    }

    await this.prisma.workflowRun.update({
      where: { id: runId },
      data: { status: 'RUNNING', context: ctx.vars as any },
    });

    try {
      await this.walk(graph, triggerNode, ctx);
      await this.complete(runId, ctx);
    } catch (e: any) {
      this.logger.error(`Run ${runId} failed: ${e?.message}`);
      await this.fail(runId, e?.message ?? 'Unknown error');
    }
  }

  private async walk(graph: WorkflowGraph, node: WorkflowNode, ctx: WorkflowRunContext): Promise<void> {
    ctx.step += 1;
    const handler = this.handlers.get(node.type);
    if (!handler) throw new Error(`No handler for node type ${node.type}`);

    const start = Date.now();
    const result: NodeExecutionResult = await handler.execute(node, ctx).catch((e) => ({
      ok: false,
      error: e?.message ?? String(e),
    }));
    const durationMs = Date.now() - start;

    // Persist context + log
    if (result.setVars) Object.assign(ctx.vars, result.setVars);
    await this.prisma.workflowRun.update({
      where: { id: ctx.runId },
      data: { currentNode: node.id, context: ctx.vars as any },
    });
    await this.prisma.workflowRunLog.create({
      data: {
        id: randomUUID(),
        workflowRunId: ctx.runId,
        nodeId: node.id,
        action: node.type,
        status: result.ok === false ? 'FAILED' : 'COMPLETED',
        input: node.configuration as any,
        output: result.output as any,
        error: result.error,
        durationMs,
      },
    });

    if (result.ok === false) {
      throw new Error(result.error || `Node ${node.name} failed`);
    }
    if (node.type === 'END') return;

    const edges = getOutgoingEdges(graph, node.id);
    const matching = edges.filter((e) => evaluateEdgeCondition(e.condition, ctx));
    if (matching.length === 0) return; // dead-end → graceful stop

    if (node.type === 'PARALLEL' && matching.length > 1) {
      // Run all branches in parallel, await all.
      await Promise.all(matching.map((e) => {
        const next = getNode(graph, e.targetNodeId);
        if (!next) return Promise.resolve();
        return this.walk(graph, next, ctx);
      }));
    } else {
      // Sequential: take first matching edge (or all if it's a flow).
      for (const e of matching) {
        const next = getNode(graph, e.targetNodeId);
        if (!next) continue;
        await this.walk(graph, next, ctx);
      }
    }
  }

  private async complete(runId: string, ctx: WorkflowRunContext) {
    await this.prisma.workflowRun.update({
      where: { id: runId },
      data: { status: 'COMPLETED', completedAt: new Date(), currentNode: null, context: ctx.vars as any },
    });
  }

  private async fail(runId: string, message: string) {
    await this.prisma.workflowRun.update({
      where: { id: runId },
      data: { status: 'FAILED', completedAt: new Date(), error: message.slice(0, 1000) },
    });
  }
}
