import { Injectable } from '@nestjs/common';
import { NodeHandler } from './node-handler.interface';
import { NodeExecutionResult, WorkflowNode, WorkflowRunContext } from '../graph.types';
import { getOutgoingEdges } from '../graph.validation';
import { evaluateEdgeCondition } from '../graph.conditions';
import { WorkflowGraph } from '../graph.types';

/**
 * PARALLEL: fan-out — runs all child nodes in parallel by marking their
 * edges as eligible. The runner itself implements the parallel branch
 * (this handler just sets a marker variable and returns).
 */
@Injectable()
export class ParallelHandler implements NodeHandler {
  readonly type = 'PARALLEL' as const;
  async execute(_node: WorkflowNode, _ctx: WorkflowRunContext): Promise<NodeExecutionResult> {
    return { note: 'Parallel fan-out' };
  }
}
