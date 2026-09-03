import { Injectable } from '@nestjs/common';
import { NodeHandler } from './node-handler.interface';
import { NodeExecutionResult, WorkflowNode, WorkflowRunContext } from '../graph.types';
import { AgentRuntimeService } from '../../../agents/agent-runtime.service';

interface AgentConfig {
  /** Optional instruction override (else uses the agent's default). */
  instruction?: string;
  /** Message to send to the agent. Supports `{var}` interpolation. */
  message?: string;
  /** Variable name to store the agent's reply under. */
  outputAs?: string;
}

/**
 * AGENT: invoke a deployed agent (synchronously, no streaming) and store
 * the reply in the run context.
 */
@Injectable()
export class AgentNodeHandler implements NodeHandler {
  readonly type = 'AGENT' as const;
  constructor(private readonly runtime: AgentRuntimeService) {}

  async execute(node: WorkflowNode, ctx: WorkflowRunContext): Promise<NodeExecutionResult> {
    if (!node.agentId) {
      return { ok: false, error: 'AGENT node missing agentId' };
    }
    const cfg = (node.configuration ?? {}) as AgentConfig;
    const message = this.interpolate(cfg.message ?? 'Hello', ctx);
    const reply = await this.runtime.run(
      {
        organizationId: ctx.organizationId,
        userId: ctx.userId ?? '00000000-0000-0000-0000-000000000000',
        agentId: node.agentId,
        message,
        conversationId: `wf-${ctx.runId}`,
        dryRun: false,
      },
    );
    return {
      setVars: cfg.outputAs ? { [cfg.outputAs]: reply.content } : { agentReply: reply.content },
      note: `Agent ${node.agentId} replied (${reply.usage?.totalTokens ?? 0} tokens)`,
      output: {
        reply: reply.content,
        tokens: reply.usage?.totalTokens,
        cost: reply.usage?.estimatedCostUsd,
      },
    };
  }

  private interpolate(template: string, ctx: WorkflowRunContext): string {
    return template.replace(/\{([a-zA-Z0-9_\.]+)\}/g, (_, key) => {
      const parts = key.split('.');
      let val: any = ctx.vars;
      for (const p of parts) {
        if (val == null) break;
        val = (val as any)[p];
      }
      return val === undefined ? '' : String(val);
    });
  }
}
