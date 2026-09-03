import { WorkflowNode, NodeExecutionResult, WorkflowRunContext } from '../graph.types';

/**
 * A NodeHandler executes a single node of a workflow and returns the data
 * the runner should merge into the run context.
 *
 * Handlers must be idempotent and side-effect-aware — the runner may retry
 * a failed step. They must NEVER throw for non-fatal issues; instead they
 * should return `{ ok: false, error: '...' }` so the run can be marked
 * FAILED with a clean error.
 */
export interface NodeHandler {
  /** Matches `NodeType`. */
  readonly type: WorkflowNode['type'];
  execute(node: WorkflowNode, ctx: WorkflowRunContext): Promise<NodeExecutionResult>;
}
