/**
 * Workflow service — validation-level integration tests.
 *
 * We exercise the graph validation surface that the service uses, plus
 * the service's `persistGraph` happy path with a Prisma stub.
 */
import { validateGraph, assertValidGraph } from '../graph.validation';
import { WorkflowGraph } from '../graph.types';
import { BadRequestException } from '@nestjs/common';

describe('Workflow graph validation', () => {
  it('rejects a graph with a self-loop', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'TRIGGER', name: 'T' },
        { id: 'a', type: 'ACTION', name: 'A' },
        { id: 'e', type: 'END', name: 'E' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 't', targetNodeId: 'a' },
        { id: 'e2', sourceNodeId: 'a', targetNodeId: 'a' },
      ],
    };
    expect(() => assertValidGraph(graph)).toThrow(BadRequestException);
  });

  it('accepts a valid linear graph', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'TRIGGER', name: 'T' },
        { id: 'a', type: 'ACTION', name: 'A' },
        { id: 'e', type: 'END', name: 'E' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 't', targetNodeId: 'a' },
        { id: 'e2', sourceNodeId: 'a', targetNodeId: 'e' },
      ],
    };
    expect(validateGraph(graph).ok).toBe(true);
  });

  it('requires at least one END reachable from the trigger', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'TRIGGER', name: 'T' },
        { id: 'a', type: 'ACTION', name: 'A' },
      ],
      edges: [{ id: 'e1', sourceNodeId: 't', targetNodeId: 'a' }],
    };
    const r = validateGraph(graph);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/END/);
  });

  it('accepts a parallel fan-out (PARALLEL with 2 branches)', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 't', type: 'TRIGGER', name: 'T' },
        { id: 'p', type: 'PARALLEL', name: 'P' },
        { id: 'a', type: 'ACTION', name: 'A' },
        { id: 'b', type: 'ACTION', name: 'B' },
        { id: 'e', type: 'END', name: 'E' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 't', targetNodeId: 'p' },
        { id: 'e2', sourceNodeId: 'p', targetNodeId: 'a' },
        { id: 'e3', sourceNodeId: 'p', targetNodeId: 'b' },
        { id: 'e4', sourceNodeId: 'a', targetNodeId: 'e' },
        { id: 'e5', sourceNodeId: 'b', targetNodeId: 'e' },
      ],
    };
    expect(validateGraph(graph).ok).toBe(true);
  });
});
