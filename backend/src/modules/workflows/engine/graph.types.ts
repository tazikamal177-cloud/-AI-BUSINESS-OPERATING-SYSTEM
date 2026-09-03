/**
 * Workflow graph definition (stored in `workflows.definition` JSONB).
 *
 * A workflow is a directed graph of nodes connected by edges. The runner
 * performs a depth-first traversal starting from the unique TRIGGER node.
 *
 * Node types are persisted as the `NodeType` enum (TRIGGER / CONDITION /
 * AGENT / ACTION / WAIT / PARALLEL / END). Within each node, the
 * `configuration` JSON holds the handler-specific payload.
 *
 * Edge conditions:
 *   - `condition: { expression: "...", kind: "js" | "jsonpath" }`
 *   - `condition: undefined`  → unconditional edge (always taken)
 *   - For CONDITION nodes, exactly one edge per branch should be taken.
 *     If `condition` is missing, the edge is the default branch.
 */

export interface WorkflowNode {
  id: string;
  type: 'TRIGGER' | 'CONDITION' | 'AGENT' | 'ACTION' | 'WAIT' | 'PARALLEL' | 'END';
  name: string;
  /** Optional agent to invoke (for AGENT nodes). */
  agentId?: string;
  /** Position for the editor UI. */
  positionX?: number;
  positionY?: number;
  /** Free-form handler payload. Schema depends on the node type. */
  configuration?: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  /** Optional label for the editor. */
  label?: string;
  /**
   * Condition to be evaluated by the runner.
   *   - undefined   → unconditional (always taken)
   *   - { kind: 'always' }
   *   - { kind: 'expression', expression: 'ctx.amount > 100' }
   *   - { kind: 'jsonpath', path: '$.status', equals: 'open' }
   */
  condition?: EdgeCondition;
}

export type EdgeCondition =
  | { kind: 'always' }
  | { kind: 'expression'; expression: string }
  | { kind: 'jsonpath'; path: string; equals?: unknown; exists?: boolean };

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowRunContext {
  /** Stable per-run id. */
  runId: string;
  /** Organization the run belongs to (for RLS + usage tracking). */
  organizationId: string;
  /** User who triggered the run (may be null for webhooks). */
  userId?: string;
  /** Trigger payload (webhook body, schedule, manual args…). */
  trigger: Record<string, unknown>;
  /** Mutable per-run context. Nodes write into it via `set` / `merge`. */
  vars: Record<string, unknown>;
  /** Step counter, exposed for debugging. */
  step: number;
}

export interface NodeExecutionResult {
  /** What to merge into the run context. */
  setVars?: Record<string, unknown>;
  /** A short human-readable note for the run log. */
  note?: string;
  /** Custom output payload (stored on the log row). */
  output?: Record<string, unknown>;
  /** If false, the runner halts the run with status=FAILED. */
  ok?: boolean;
  /** Error message when ok=false. */
  error?: string;
}
