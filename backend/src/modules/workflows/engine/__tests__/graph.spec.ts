import { validateGraph } from '../graph.validation';
import { evaluateEdgeCondition } from '../graph.conditions';
import { resolveJsonPath } from '../jsonpath';
import { WorkflowGraph, WorkflowRunContext } from '../graph.types';

describe('graph.validation', () => {
  it('accepts a minimal trigger→end graph', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'TRIGGER', name: 'T' },
        { id: 'e', type: 'END', name: 'E' },
      ],
      edges: [{ id: 'e1', sourceNodeId: 't', targetNodeId: 'e' }],
    };
    expect(validateGraph(g)).toEqual({ ok: true, errors: [] });
  });

  it('rejects a graph without a TRIGGER', () => {
    const g: WorkflowGraph = {
      nodes: [{ id: 'a', type: 'ACTION', name: 'A' }, { id: 'e', type: 'END', name: 'E' }],
      edges: [{ id: 'e1', sourceNodeId: 'a', targetNodeId: 'e' }],
    };
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(expect.arrayContaining([expect.stringMatching(/TRIGGER/)]));
  });

  it('rejects a graph with multiple TRIGGERs', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 't1', type: 'TRIGGER', name: 'T1' },
        { id: 't2', type: 'TRIGGER', name: 'T2' },
        { id: 'e', type: 'END', name: 'E' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 't1', targetNodeId: 'e' },
        { id: 'e2', sourceNodeId: 't2', targetNodeId: 'e' },
      ],
    };
    expect(validateGraph(g).ok).toBe(false);
  });

  it('detects cycles', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'TRIGGER', name: 'T' },
        { id: 'a', type: 'ACTION', name: 'A' },
        { id: 'b', type: 'ACTION', name: 'B' },
        { id: 'e', type: 'END', name: 'E' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 't', targetNodeId: 'a' },
        { id: 'e2', sourceNodeId: 'a', targetNodeId: 'b' },
        { id: 'e3', sourceNodeId: 'b', targetNodeId: 'a' },
      ],
    };
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Cycle/);
  });

  it('rejects self-loops', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'TRIGGER', name: 'T' },
        { id: 'a', type: 'ACTION', name: 'A' },
        { id: 'e', type: 'END', name: 'E' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 't', targetNodeId: 'a' },
        { id: 'e2', sourceNodeId: 'a', targetNodeId: 'a' },
        { id: 'e3', sourceNodeId: 'a', targetNodeId: 'e' },
      ],
    };
    expect(validateGraph(g).ok).toBe(false);
  });

  it('rejects an unreachable END', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'TRIGGER', name: 'T' },
        { id: 'a', type: 'ACTION', name: 'A' },
        { id: 'e', type: 'END', name: 'E' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 't', targetNodeId: 'a' },
        // a has no outgoing edge
      ],
    };
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/END/);
  });

  it('rejects edges with unknown endpoints', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'TRIGGER', name: 'T' },
        { id: 'e', type: 'END', name: 'E' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 't', targetNodeId: 'missing' },
      ],
    };
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
  });
});

describe('jsonpath', () => {
  it('resolves nested paths', () => {
    expect(resolveJsonPath({ a: { b: { c: 42 } } }, '$.a.b.c')).toBe(42);
    expect(resolveJsonPath({ a: [{ x: 1 }, { x: 2 }] }, '$.a[1].x')).toBe(2);
  });
  it('returns undefined for missing paths', () => {
    expect(resolveJsonPath({}, '$.a.b')).toBeUndefined();
  });
});

describe('edge conditions', () => {
  const ctx = (vars: Record<string, unknown>): WorkflowRunContext => ({
    runId: 'r1',
    organizationId: 'org1',
    trigger: {},
    vars,
    step: 0,
  });

  it('unconditional edge is always taken', () => {
    expect(evaluateEdgeCondition(undefined, ctx({}))).toBe(true);
    expect(evaluateEdgeCondition({ kind: 'always' }, ctx({}))).toBe(true);
  });

  it('jsonpath equality', () => {
    expect(evaluateEdgeCondition({ kind: 'jsonpath', path: '$.status', equals: 'open' }, ctx({ status: 'open' }))).toBe(true);
    expect(evaluateEdgeCondition({ kind: 'jsonpath', path: '$.status', equals: 'open' }, ctx({ status: 'closed' }))).toBe(false);
  });

  it('jsonpath exists', () => {
    expect(evaluateEdgeCondition({ kind: 'jsonpath', path: '$.a', exists: true }, ctx({ a: 1 }))).toBe(true);
    expect(evaluateEdgeCondition({ kind: 'jsonpath', path: '$.a', exists: true }, ctx({}))).toBe(false);
  });
});
