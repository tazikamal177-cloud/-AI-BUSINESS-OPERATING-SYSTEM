import { Injectable } from '@nestjs/common';
import { NodeHandler } from './node-handler.interface';
import { NodeExecutionResult, WorkflowNode, WorkflowRunContext } from '../graph.types';
import { ToolExecutor } from '../../../tools/tool-executor';

interface ActionConfig {
  /** Tool slug to call. */
  tool: string;
  /** Args to pass to the tool (supports `{var}` interpolation). */
  arguments?: Record<string, unknown>;
  /** Variable name to store the result under. */
  outputAs?: string;
  /** Max retries on transient failure. Default: 0. */
  retries?: number;
}

/**
 * ACTION: invoke a registered tool (built-in, integration or per-org
 * custom). Retries with linear backoff on retryable errors.
 */
@Injectable()
export class ActionNodeHandler implements NodeHandler {
  readonly type = 'ACTION' as const;
  constructor(private readonly toolExec: ToolExecutor) {}

  async execute(node: WorkflowNode, ctx: WorkflowRunContext): Promise<NodeExecutionResult> {
    const cfg = (node.configuration ?? {}) as unknown as ActionConfig;
    if (!cfg.tool) return { ok: false, error: 'ACTION node missing `tool` slug' };
    const args = this.interpolateArgs(cfg.arguments ?? {}, ctx);
    const maxRetries = Math.max(0, cfg.retries ?? 0);

    let lastErr: string | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await this.toolExec.execute(
        { id: `wf-${ctx.runId}-${node.id}-${attempt}`, name: cfg.tool, arguments: JSON.stringify(args) },
        {
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          conversationId: `wf-${ctx.runId}`,
        },
      );
      if (result.ok) {
        return {
          setVars: cfg.outputAs ? { [cfg.outputAs]: result.output } : { actionResult: result.output },
          note: `Action ${cfg.tool} ok (${result.durationMs}ms)`,
          output: result.output as any,
        };
      }
      lastErr = result.error;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
      }
    }
    return { ok: false, error: lastErr ?? 'Action failed' };
  }

  private interpolateArgs(args: Record<string, unknown>, ctx: WorkflowRunContext): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === 'string') {
        out[k] = v.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_, key) => {
          const parts = key.split('.');
          let val: any = ctx.vars;
          for (const p of parts) {
            if (val == null) break;
            val = (val as any)[p];
          }
          return val === undefined ? '' : String(val);
        });
      } else {
        out[k] = v;
      }
    }
    return out;
  }
}
