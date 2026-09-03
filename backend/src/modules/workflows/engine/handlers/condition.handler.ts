import { Injectable } from '@nestjs/common';
import { NodeHandler } from './node-handler.interface';
import { NodeExecutionResult, WorkflowNode, WorkflowRunContext } from '../graph.types';
import { resolveJsonPath } from '../jsonpath';

interface ConditionConfig {
  /** Name of the variable to evaluate. */
  variable?: string;
  /** JSONPath expression. */
  path?: string;
  /** Equality check (string/number/bool). */
  equals?: unknown;
  /** Existence check (true if non-null). */
  exists?: boolean;
  /** Comparison operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq'. */
  op?: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';
  /** Numeric threshold for comparison. */
  value?: number;
}

/**
 * CONDITION: evaluates a predicate on the run context and stores a boolean
 * in `vars.<outputAs>` (default `_lastCondition`). The runner then uses
 * edge-level `condition` to pick the next node(s).
 *
 * For simple JSONPath + equality checks this is enough. For complex
 * expressions, prefer embedding the logic in an AGENT node or a CODE
 * node (Phase 10+).
 */
@Injectable()
export class ConditionHandler implements NodeHandler {
  readonly type = 'CONDITION' as const;
  async execute(node: WorkflowNode, ctx: WorkflowRunContext): Promise<NodeExecutionResult> {
    const cfg = (node.configuration ?? {}) as ConditionConfig;
    let value: any;
    if (cfg.path) {
      value = resolveJsonPath(ctx.vars, cfg.path);
    } else if (cfg.variable) {
      value = ctx.vars[cfg.variable];
    } else {
      return { ok: false, error: 'CONDITION node requires `path` or `variable`' };
    }

    let result: boolean;
    if (cfg.exists !== undefined) {
      result = cfg.exists ? value !== undefined && value !== null : value === undefined || value === null;
    } else if (cfg.op && cfg.value !== undefined && typeof value === 'number') {
      switch (cfg.op) {
        case 'gt': result = value > cfg.value; break;
        case 'gte': result = value >= cfg.value; break;
        case 'lt': result = value < cfg.value; break;
        case 'lte': result = value <= cfg.value; break;
        case 'eq': result = value === cfg.value; break;
        case 'neq': result = value !== cfg.value; break;
      }
    } else {
      result = cfg.equals !== undefined ? value === cfg.equals : Boolean(value);
    }

    return {
      setVars: { _lastCondition: result, _lastConditionValue: value },
      note: `Condition → ${result}`,
    };
  }
}
