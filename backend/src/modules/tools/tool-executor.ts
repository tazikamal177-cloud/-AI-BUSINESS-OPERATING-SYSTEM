import { Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Ajv, { ValidateFunction } from 'ajv';
import { PrismaService } from '../../prisma/prisma.service';
import { ToolsService } from './tools.service';
import { TasksService } from '../tasks/tasks.service';
import { AuditService } from '../audit/audit.service';
import { ToolSpec, UnifiedToolCall } from '../ai/types/provider.types';

export interface ToolExecutionContext {
  organizationId: string;
  userId?: string;
  agentId?: string;
  conversationId?: string;
  messageId?: string;
  agentVersionId?: string;
}

export interface ToolExecutionResult {
  toolCallId: string;
  toolName: string;
  ok: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
  requiresApproval?: boolean;
  taskId?: string;
  blocked?: boolean;
  blockReason?: string;
}

/**
 * ToolExecutor — single point of execution for all tool calls.
 *
 * Responsibilities:
 *   1. Resolve the tool (registry or DB)
 *   2. Validate arguments against the JSON schema (Ajv)
 *   3. Enforce risk-level policy (LOW = auto, MEDIUM = log+execute, HIGH = require approval)
 *   4. Enforce per-tool timeout
 *   5. Record `tool_executions` row + audit log
 *   6. Return normalized result (or a "blocked" envelope if approval is required)
 */
@Injectable()
export class ToolExecutor {
  private readonly logger = new Logger(ToolExecutor.name);
  private ajv: Ajv;
  /** Per-tool schema cache (Ajv compiled). */
  private schemaCache = new Map<string, ValidateFunction>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tools: ToolsService,
    private readonly tasks: TasksService,
    private readonly audit: AuditService,
  ) {
    this.ajv = new Ajv({ allErrors: true, removeAdditional: false, useDefaults: true });
  }

  /**
   * Execute a single tool call produced by the model.
   */
  async execute(
    call: UnifiedToolCall,
    ctx: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const start = Date.now();

    // Resolve the tool: DB first (per-org custom / webhook / registered
    // integration tools), then the in-memory registry (built-ins + SAV).
    let tool: { id: string; slug: string; inputSchema: any; riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' } | null =
      await this.resolveTool(call.name, ctx.organizationId);

    let resolvedFromRegistry = false;
    if (!tool) {
      const registered = this.tools.getRegistered(call.name);
      if (registered) {
        tool = {
          id: `builtin:${registered.name}`,
          slug: registered.name,
          inputSchema: registered.inputSchema,
          riskLevel: registered.riskLevel,
        };
        resolvedFromRegistry = true;
      }
    }
    if (!tool) {
      return this.recordFailure(call, ctx, start, 'Tool not found in registry', 'TOOL_NOT_FOUND', 404);
    }

    // 1. Validate arguments
    const args = this.parseArgs(call.arguments);
    const validate = this.getValidator(tool.id, tool.inputSchema as any);
    if (!validate(args)) {
      const errMsg = this.ajv.errorsText(validate.errors);
      return this.recordFailure(call, ctx, start, `Invalid arguments: ${errMsg}`, 'TOOL_INVALID_ARGS', 400);
    }

    // 2. Risk policy
    if (tool.riskLevel === 'HIGH') {
      if (resolvedFromRegistry) {
        return this.recordFailure(
          call,
          ctx,
          start,
          'High-risk tool must be a registered (DB) tool to require approval',
          'TOOL_HIGH_RISK_UNTRACKED',
          400,
        );
      }
      const task = await this.tasks.createApprovalTask({
        organizationId: ctx.organizationId,
        agentId: ctx.agentId,
        conversationId: ctx.conversationId,
        title: `Approve tool "${call.name}"`,
        description: `The agent wants to run tool **${call.name}** with the following arguments:\n\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\``,
        payload: { toolName: call.name, toolId: tool.id, arguments: args },
      });
      await this.recordExecutionRow({
        toolId: tool.id,
        ctx,
        input: args,
        status: 'PENDING',
        error: 'Awaiting human approval',
        durationMs: Date.now() - start,
      });
      await this.audit.log({
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: 'tool.execution.requires_approval',
        resourceType: 'tool',
        resourceId: tool.id,
        metadata: { toolName: call.name, arguments: args, taskId: task.id },
        result: 'PENDING',
      });
      return {
        toolCallId: call.id,
        toolName: call.name,
        ok: false,
        blocked: true,
        requiresApproval: true,
        taskId: task.id,
        blockReason: 'High-risk tool requires human approval',
        durationMs: Date.now() - start,
      };
    }

    // 3. Execute with timeout
    try {
      const output = await this.runWithTimeout(
        () => this.tools.executeTool(call.name, args, ctx),
        tool.id,
        30_000,
      );
      const durationMs = Date.now() - start;
      if (!resolvedFromRegistry) {
        await this.recordExecutionRow({
          toolId: tool.id, ctx, input: args, output, status: 'COMPLETED', durationMs,
        });
      }
      await this.audit.log({
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: tool.riskLevel === 'MEDIUM' ? 'tool.execution.medium_risk' : 'tool.execution',
        resourceType: 'tool',
        resourceId: tool.id,
        metadata: { toolName: call.name, arguments: args, durationMs, risk: tool.riskLevel, source: resolvedFromRegistry ? 'registry' : 'db' },
        result: 'SUCCESS',
      });
      return { toolCallId: call.id, toolName: call.name, ok: true, output, durationMs };
    } catch (e: any) {
      const durationMs = Date.now() - start;
      if (!resolvedFromRegistry) {
        await this.recordExecutionRow({
          toolId: tool.id, ctx, input: args, status: 'FAILED', error: e?.message ?? String(e), durationMs,
        });
      }
      await this.audit.log({
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: 'tool.execution.failed',
        resourceType: 'tool',
        resourceId: tool.id,
        metadata: { toolName: call.name, error: e?.message, source: resolvedFromRegistry ? 'registry' : 'db' },
        result: 'FAILURE',
      });
      return { toolCallId: call.id, toolName: call.name, ok: false, error: e?.message, durationMs };
    }
  }

  /** Build a ToolSpec list for the model from the agent's attached tools. */
  async buildSpecsForAgent(agentId: string, orgId: string): Promise<ToolSpec[]> {
    const attached = await this.prisma.agentTool.findMany({
      where: { agentId },
      include: { tool: true },
    });
    return attached
      .filter((at) => at.tool.status === 'ACTIVE')
      .map((at) => ({
        name: at.tool.slug,
        description: at.tool.description,
        inputSchema: (at.tool.inputSchema as any) ?? { type: 'object', properties: {} },
      }));
  }

  /** Resolve a tool by slug from the org's registry (built-in or org-specific). */
  private async resolveTool(slug: string, orgId: string) {
    return this.prisma.tool.findFirst({
      where: {
        slug,
        OR: [{ organizationId: null }, { organizationId: orgId }],
        status: 'ACTIVE',
      },
    });
  }

  private parseArgs(s: string): Record<string, unknown> {
    if (!s) return {};
    try {
      const parsed = JSON.parse(s);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new BadRequestException('Tool arguments must be a JSON object');
      }
      return parsed;
    } catch (e: any) {
      throw new BadRequestException(`Invalid tool arguments JSON: ${e?.message ?? e}`);
    }
  }

  private getValidator(toolId: string, schema: any): ValidateFunction {
    const key = `${toolId}:${JSON.stringify(schema)}`;
    let v = this.schemaCache.get(key);
    if (!v) {
      v = this.ajv.compile(schema ?? { type: 'object', properties: {} });
      this.schemaCache.set(key, v);
    }
    return v;
  }

  private async runWithTimeout<T>(fn: () => Promise<T>, _id: string, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Tool execution timeout after ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([fn(), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async recordExecutionRow(args: {
    toolId: string;
    ctx: ToolExecutionContext;
    input: unknown;
    output?: unknown;
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
    error?: string;
    durationMs: number;
  }) {
    return this.prisma.toolExecution.create({
      data: {
        id: randomUUID(),
        toolId: args.toolId,
        organizationId: args.ctx.organizationId,
        agentId: args.ctx.agentId,
        conversationId: args.ctx.conversationId,
        messageId: args.ctx.messageId,
        input: args.input as any,
        output: args.output as any,
        status: args.status,
        error: args.error,
        durationMs: args.durationMs,
      },
    });
  }

  private async recordFailure(
    call: UnifiedToolCall,
    ctx: ToolExecutionContext,
    start: number,
    message: string,
    code: string,
    httpStatus: number,
  ): Promise<ToolExecutionResult> {
    await this.audit.log({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: `tool.execution.${code.toLowerCase()}`,
      resourceType: 'tool',
      metadata: { toolName: call.name, arguments: call.arguments, error: message },
      result: 'FAILURE',
    });
    const e = httpStatus === 404 ? new NotFoundException(message) : new BadRequestException({ code, message });
    return { toolCallId: call.id, toolName: call.name, ok: false, error: message, durationMs: Date.now() - start };
  }
}
