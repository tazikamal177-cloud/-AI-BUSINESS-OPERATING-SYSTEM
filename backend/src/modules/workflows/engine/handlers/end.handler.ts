import { Injectable } from '@nestjs/common';
import { NodeHandler } from './node-handler.interface';
import { NodeExecutionResult, WorkflowNode, WorkflowRunContext } from '../graph.types';

/**
 * END: terminal node. The runner halts when it reaches an END (after
 * recording the log row). Handler is a no-op.
 */
@Injectable()
export class EndHandler implements NodeHandler {
  readonly type = 'END' as const;
  async execute(_node: WorkflowNode, _ctx: WorkflowRunContext): Promise<NodeExecutionResult> {
    return { note: 'Workflow ended' };
  }
}
