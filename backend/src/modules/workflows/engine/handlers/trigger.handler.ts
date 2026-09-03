import { Injectable } from '@nestjs/common';
import { NodeHandler } from './node-handler.interface';
import { NodeExecutionResult, WorkflowNode, WorkflowRunContext } from '../graph.types';

/**
 * TRIGGER: the entry point. Records the trigger payload into the context
 * under `vars.trigger` and is a no-op otherwise.
 */
@Injectable()
export class TriggerHandler implements NodeHandler {
  readonly type = 'TRIGGER' as const;
  async execute(node: WorkflowNode, ctx: WorkflowRunContext): Promise<NodeExecutionResult> {
    return {
      setVars: { trigger: ctx.trigger, triggerName: node.name },
      note: 'Trigger received',
    };
  }
}
