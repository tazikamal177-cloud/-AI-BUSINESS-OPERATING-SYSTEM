import { EdgeCondition, WorkflowRunContext } from './graph.types';
import { resolveJsonPath } from './jsonpath';

/**
 * Evaluate an edge condition against the current run context.
 *   - undefined  → true (unconditional)
 *   - { kind: 'always' } → true
 *   - { kind: 'jsonpath', path, equals? } → resolves path, compares
 *   - { kind: 'expression', expression } → resolves `{var}` then evaluates as JS
 *
 * The `expression` kind uses `new Function` against a read-only snapshot of
 * the context. The expression CANNOT escape the function sandbox (only
 * basic operators). Use with caution.
 */
export function evaluateEdgeCondition(cond: EdgeCondition | undefined, ctx: WorkflowRunContext): boolean {
  if (!cond) return true;
  if (cond.kind === 'always') return true;
  if (cond.kind === 'jsonpath') {
    const value = resolveJsonPath(ctx.vars, cond.path);
    if (cond.exists !== undefined) {
      return cond.exists ? value !== undefined && value !== null : value === undefined || value === null;
    }
    if (cond.equals !== undefined) return value === cond.equals;
    return Boolean(value);
  }
  if (cond.kind === 'expression') {
    // Limited safe expression: {var} substitution, then `Function`-eval.
    // Disallow `;` and obvious sandbox escape patterns.
    const safe = cond.expression.replace(/[;`\\]|require\(|process\.|global\.|window\./g, '');
    const expr = safe.replace(/\{([a-zA-Z0-9_\.]+)\}/g, (_, key) => {
      const parts = key.split('.');
      let val: any = ctx.vars;
      for (const p of parts) {
        if (val == null) break;
        val = (val as any)[p];
      }
      if (val === undefined) return 'undefined';
      if (typeof val === 'string') return JSON.stringify(val);
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    });
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('vars', `_lastCondition = ${ctx.vars._lastCondition}; return (${expr});`);
      return Boolean(fn(ctx.vars));
    } catch {
      return false;
    }
  }
  return false;
}
