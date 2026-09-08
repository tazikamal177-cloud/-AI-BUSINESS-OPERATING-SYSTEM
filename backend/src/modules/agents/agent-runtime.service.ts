import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AiGatewayService } from '../ai/gateway/ai-gateway.service';
import { ChatMessage, ToolSpec } from '../ai/types/provider.types';
import { ToolExecutor, ToolExecutionContext } from '../tools/tool-executor';
import { MemoryService } from '../memory/memory.service';
import { RagService } from '../knowledge/rag.service';
import { UsageService } from '../quota/usage.service';
import { QuotaService } from '../quota/quota.service';
import { AuditService } from '../audit/audit.service';
import { ProviderError } from '../ai/types/provider.types';

export interface AgentRunContext {
  organizationId: string;
  userId: string;
  agentId: string;
  agentVersionId?: string;   // Pinned version (deployments pin one)
  conversationId: string;
  message: string;
  /** When true: do not record usage or persist messages. Used by /test. */
  dryRun?: boolean;
}

export interface AgentRunEvent {
  type: 'message.start' | 'message.delta' | 'tool.call' | 'tool.result' | 'message.done' | 'error';
  [k: string]: unknown;
}

export interface AgentRunResult {
  messageId?: string;
  content: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    ok: boolean;
    error?: string;
    requiresApproval?: boolean;
    taskId?: string;
  }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  citations: Array<{ documentId: string; documentName: string; chunkId: string }>;
  error?: { code: string; message: string };
}

const MAX_TOOL_ITERATIONS = 10;

/**
 * AgentRuntimeService — the shared kernel for every agent in the system.
 *
 *   Input
 *   → Sanitize & load agent + (optional) pinned version
 *   → Quota check (pre-flight estimate)
 *   → Build context: system prompt + memory + RAG + tool specs
 *   → Tool-calling loop (model ↔ tools)
 *   → Final response
 *   → Persist messages, record usage, audit
 *
 * The runtime emits `AgentRunEvent`s for streaming.
 */
@Injectable()
export class AgentRuntimeService {
  private readonly logger = new Logger(AgentRuntimeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGatewayService,
    private readonly toolExec: ToolExecutor,
    private readonly memory: MemoryService,
    private readonly rag: RagService,
    private readonly usage: UsageService,
    private readonly quota: QuotaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Execute an agent run. Returns a final result and (optionally) streams
   * events via `onEvent`.
   */
  async run(
    ctx: AgentRunContext,
    onEvent?: (e: AgentRunEvent) => void,
  ): Promise<AgentRunResult> {
    const start = Date.now();

    // 1. Load agent
    const agent = await this.prisma.agent.findFirst({
      where: { id: ctx.agentId, organizationId: ctx.organizationId },
      include: {
        agentTools: { include: { tool: true } },
        agentKnowledge: true,
      },
    });
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.status === 'ARCHIVED' || agent.deletedAt) throw new BadRequestException('Agent is archived');
    if (!ctx.dryRun && agent.status !== 'ACTIVE') {
      throw new BadRequestException('Agent is not active. Deploy it first.');
    }

    // 2. Pre-flight quota
    const estimated = this.gateway.get(agent.modelProvider).countTokens(ctx.message) * 4;
    const quotaCheck = await this.quota.enforce(ctx.organizationId, estimated);
    if (!quotaCheck.allowed) {
      throw new BadRequestException({
        code: 'QUOTA_EXCEEDED',
        message: quotaCheck.reason,
        details: quotaCheck.status,
      });
    }

    // 3. Build tool specs + system prompt
    const toolSpecs = this.toolExec.buildSpecsForAgent
      ? await this.toolExec.buildSpecsForAgent(agent.id, agent.organizationId)
      : await this.buildToolSpecs(agent);
    const knowledgeBaseIds = agent.agentKnowledge.map((ak) => ak.knowledgeBaseId);

    // 4. RAG retrieval (background; if fails, continue without)
    let ragContext = '';
    let citations: AgentRunResult['citations'] = [];
    try {
      const chunks = await this.rag.retrieve({
        organizationId: ctx.organizationId,
        knowledgeBaseIds,
        query: ctx.message,
        topK: 5,
      });
      ragContext = this.rag.buildContext(chunks);
      citations = chunks.map((c) => ({
        documentId: c.documentId,
        documentName: c.documentName,
        chunkId: c.id,
      }));
    } catch (e) {
      this.logger.warn(`RAG retrieval failed: ${(e as Error).message}`);
    }

    const systemPrompt = this.buildSystemPrompt(agent) + ragContext;

    // 5. Build initial message history (DB messages)
    const history = await this.loadHistory(ctx.conversationId);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: ctx.message },
    ];

    // 6. Save user message
    if (!ctx.dryRun) {
      await this.prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: ctx.conversationId,
          role: 'USER',
          content: ctx.message,
        },
      });
    }

    // 7. Tool-calling loop
    onEvent?.({ type: 'message.start' });
    const allToolCalls: AgentRunResult['toolCalls'] = [];
    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;
    let finalContent = '';
    let modelError: { code: string; message: string } | undefined;

    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      let response;
      try {
        response = await this.gateway.chatStream(
          {
            model: agent.modelName,
            messages,
            temperature: agent.temperature,
            maxTokens: agent.maxTokens,
            tools: toolSpecs.length ? toolSpecs : undefined,
          },
          (chunk) => {
            if (chunk.content) {
              onEvent?.({ type: 'message.delta', content: chunk.content });
            }
          },
          agent.modelProvider,
        );
      } catch (e) {
        if (e instanceof ProviderError) {
          modelError = { code: `PROVIDER_${e.code.toUpperCase()}`, message: e.message };
        } else {
          modelError = { code: 'PROVIDER_ERROR', message: (e as Error).message };
        }
        onEvent?.({ type: 'error', code: modelError.code, message: modelError.message });
        break;
      }

      totalInput += response.usage.inputTokens;
      totalOutput += response.usage.outputTokens;
      totalCost += response.usage.estimatedCostUsd;
      finalContent = response.content;

      // No tool calls → done
      if (!response.toolCalls?.length) {
        break;
      }

      // Push assistant message with tool calls
      messages.push({ role: 'assistant', content: response.content, toolCalls: response.toolCalls });

      // Execute each tool call
      for (const tc of response.toolCalls) {
        onEvent?.({ type: 'tool.call', id: tc.id, name: tc.name });
        const toolResult = await this.toolExec.execute(tc, this.buildToolCtx(ctx, agent.id));

        allToolCalls.push({
          id: tc.id,
          name: tc.name,
          arguments: this.safeJson(tc.arguments),
          ok: toolResult.ok,
          error: toolResult.error,
          requiresApproval: toolResult.requiresApproval,
          taskId: toolResult.taskId,
        });

        onEvent?.({
          type: 'tool.result',
          id: tc.id,
          name: tc.name,
          ok: toolResult.ok,
          output: toolResult.output,
          error: toolResult.error,
          requiresApproval: toolResult.requiresApproval,
          taskId: toolResult.taskId,
        });

        // Feed back to the model (or to short-term memory if blocked)
        if (toolResult.requiresApproval) {
          // Don't feed back to model — execution is pending
          messages.push({
            role: 'tool',
            toolCallId: tc.id,
            name: tc.name,
            content: JSON.stringify({
              status: 'PENDING_APPROVAL',
              message: toolResult.blockReason,
              taskId: toolResult.taskId,
            }),
          });
        } else {
          messages.push({
            role: 'tool',
            toolCallId: tc.id,
            name: tc.name,
            content: JSON.stringify(
              toolResult.ok ? { ok: true, output: toolResult.output } : { ok: false, error: toolResult.error },
            ),
          });
        }
      }
    }

    onEvent?.({ type: 'message.done' });

    // 8. Persist assistant message
    let savedMessageId: string | undefined;
    if (!ctx.dryRun) {
      const saved = await this.prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: ctx.conversationId,
          role: 'ASSISTANT',
          content: finalContent,
          toolCalls: allToolCalls as any,
          tokens: totalInput + totalOutput,
          metadata: { citations, durationMs: Date.now() - start },
        },
      });
      savedMessageId = saved.id;
    }

    // 9. Record usage
    if (!ctx.dryRun && (totalInput + totalOutput > 0)) {
      await this.usage.record({
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        agentId: agent.id,
        agentVersionId: ctx.agentVersionId,
        conversationId: ctx.conversationId,
        messageId: savedMessageId,
        modelProvider: agent.modelProvider,
        modelName: agent.modelName,
        usage: {
          inputTokens: totalInput,
          outputTokens: totalOutput,
          totalTokens: totalInput + totalOutput,
          estimatedCostUsd: totalCost,
        },
        operation: 'agent_execution',
        metadata: { durationMs: Date.now() - start, iterations: allToolCalls.length },
      });
    }

    // 10. Short-term memory
    if (!ctx.dryRun) {
      await this.memory.pushShortTerm(ctx.conversationId, 'user', ctx.message);
      await this.memory.pushShortTerm(ctx.conversationId, 'assistant', finalContent);
    }

    // 11. Audit
    await this.audit.log({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'agent.execution',
      resourceType: 'agent',
      resourceId: agent.id,
      metadata: {
        conversationId: ctx.conversationId,
        messageId: savedMessageId,
        durationMs: Date.now() - start,
        tokens: totalInput + totalOutput,
        costUsd: totalCost,
        toolCallCount: allToolCalls.length,
        error: modelError,
      },
      result: modelError ? 'FAILURE' : 'SUCCESS',
    });

    return {
      messageId: savedMessageId,
      content: finalContent,
      toolCalls: allToolCalls,
      usage: {
        inputTokens: totalInput,
        outputTokens: totalOutput,
        totalTokens: totalInput + totalOutput,
        estimatedCostUsd: totalCost,
      },
      citations,
      error: modelError,
    };
  }

  // ──────────────── helpers ────────────────

  private buildSystemPrompt(agent: any): string {
    let prompt = agent.systemInstructions || 'You are a helpful AI assistant.';
    if (agent.objective) prompt += `\n\n## Objective\n${agent.objective}`;
    if (agent.personality) prompt += `\n\n## Personality\n${agent.personality}`;
    if (agent.tone) prompt += `\n\n## Tone\nRespond in a ${agent.tone} manner.`;
    if (agent.guardrails) {
      const g = typeof agent.guardrails === 'string' ? JSON.parse(agent.guardrails) : agent.guardrails;
      if (Array.isArray(g) && g.length) prompt += `\n\n## Guardrails\n${g.map((x: string) => `- ${x}`).join('\n')}`;
    }
    prompt += `\n\n## Language\nRespond in ${agent.language || 'English'}.`;
    return prompt;
  }

  private async loadHistory(conversationId: string): Promise<ChatMessage[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    return rows.map((m) => {
      const out: ChatMessage = {
        role: m.role.toLowerCase() as any,
        content: m.content,
      };
      if (m.toolCalls && Array.isArray(m.toolCalls)) out.toolCalls = m.toolCalls as any;
      if (m.role === 'TOOL') {
        const meta = m.metadata as any;
        out.toolCallId = meta?.toolCallId;
        out.name = meta?.name;
      }
      return out;
    });
  }

  private async buildToolSpecs(agent: any): Promise<ToolSpec[]> {
    return agent.agentTools
      .filter((at: any) => at.tool.status === 'ACTIVE')
      .map((at: any) => ({
        name: at.tool.slug,
        description: at.tool.description,
        inputSchema: at.tool.inputSchema ?? { type: 'object', properties: {} },
      }));
  }

  private buildToolCtx(ctx: AgentRunContext, agentId: string): ToolExecutionContext {
    return {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      agentId,
      conversationId: ctx.conversationId,
    };
  }

  private safeJson(s: string): Record<string, unknown> {
    try { return JSON.parse(s); } catch { return {}; }
  }
}
