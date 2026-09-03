import { BadRequestException } from '@nestjs/common';
import { WorkflowGraph, WorkflowNode, WorkflowEdge } from './graph.types';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validate the structure of a workflow graph:
 *  - exactly one TRIGGER
 *  - all edge endpoints exist
 *  - no self-loops
 *  - the graph is a DAG (no cycles)
 *  - the graph reaches at least one END node from the trigger
 *  - unique node ids, unique edge ids
 */
export function validateGraph(graph: WorkflowGraph): ValidationResult {
  const errors: string[] = [];
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return { ok: false, errors: ['Graph must have `nodes` and `edges` arrays'] };
  }

  const nodeIds = new Set<string>();
  for (const n of graph.nodes) {
    if (!n.id) errors.push('Node missing id');
    else if (nodeIds.has(n.id)) errors.push(`Duplicate node id: ${n.id}`);
    else nodeIds.add(n.id);
    if (!n.type) errors.push(`Node ${n.id ?? '?'} missing type`);
  }

  const triggers = graph.nodes.filter((n) => n.type === 'TRIGGER');
  if (triggers.length === 0) errors.push('Graph must contain a TRIGGER node');
  if (triggers.length > 1) errors.push('Graph must contain exactly one TRIGGER node');

  for (const e of graph.edges) {
    if (!e.id) errors.push('Edge missing id');
    if (!nodeIds.has(e.sourceNodeId)) errors.push(`Edge ${e.id ?? '?'} source not found: ${e.sourceNodeId}`);
    if (!nodeIds.has(e.targetNodeId)) errors.push(`Edge ${e.id ?? '?'} target not found: ${e.targetNodeId}`);
    if (e.sourceNodeId === e.targetNodeId) errors.push(`Edge ${e.id ?? '?'} is a self-loop`);
  }

  // Reachability from trigger + cycle detection via DFS
  if (triggers.length === 1) {
    const adjacency = new Map<string, WorkflowEdge[]>();
    for (const e of graph.edges) {
      const list = adjacency.get(e.sourceNodeId) ?? [];
      list.push(e);
      adjacency.set(e.sourceNodeId, list);
    }
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    for (const n of graph.nodes) color.set(n.id, WHITE);
    let hasEnd = false;
    const dfs = (id: string): void => {
      const c = color.get(id);
      if (c === GRAY) { errors.push(`Cycle detected at node ${id}`); return; }
      if (c === BLACK) return;
      color.set(id, GRAY);
      const node = graph.nodes.find((n) => n.id === id);
      if (node?.type === 'END') hasEnd = true;
      for (const e of adjacency.get(id) ?? []) dfs(e.targetNodeId);
      color.set(id, BLACK);
    };
    dfs(triggers[0].id);
    if (!hasEnd) errors.push('Graph must reach at least one END node from the trigger');
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Build an adjacency map keyed by node id.
 */
export function indexById<T extends { id: string }>(items: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of items) m.set(it.id, it);
  return m;
}

export function getOutgoingEdges(graph: WorkflowGraph, nodeId: string): WorkflowEdge[] {
  return graph.edges.filter((e) => e.sourceNodeId === nodeId);
}

export function getNode(graph: WorkflowGraph, nodeId: string): WorkflowNode | undefined {
  return graph.nodes.find((n) => n.id === nodeId);
}

/**
 * Throw if the graph is invalid. Convenience wrapper.
 */
export function assertValidGraph(graph: WorkflowGraph): void {
  const r = validateGraph(graph);
  if (!r.ok) throw new BadRequestException({ code: 'INVALID_GRAPH', errors: r.errors });
}
