import { Injectable } from '@nestjs/common';
import { NodeHandler } from './node-handler.interface';
import { NodeExecutionResult, WorkflowNode, WorkflowRunContext } from '../graph.types';

interface WaitConfig {
  /** Delay in milliseconds. */
  ms?: number;
  /** ISO-8601 datetime to wait until. */
  until?: string;
  /** Cap to prevent runaway waits (default: 1 hour). */
  maxMs?: number;
}

const ONE_HOUR = 60 * 60 * 1000;

/**
 * WAIT: pause execution for `ms` or until `until`. The runner schedules a
 * `setTimeout`-style wait inline (no queue). Long delays should be
 * split into smaller jobs in production.
 */
@Injectable()
export class WaitHandler implements NodeHandler {
  readonly type = 'WAIT' as const;
  async execute(node: WorkflowNode, _ctx: WorkflowRunContext): Promise<NodeExecutionResult> {
    const cfg = (node.configuration ?? {}) as WaitConfig;
    let ms: number;
    if (cfg.until) {
      ms = new Date(cfg.until).getTime() - Date.now();
    } else {
      ms = cfg.ms ?? 0;
    }
    const cap = cfg.maxMs ?? ONE_HOUR;
    if (ms < 0) ms = 0;
    if (ms > cap) ms = cap;
    await new Promise((r) => setTimeout(r, ms));
    return { note: `Waited ${ms}ms`, setVars: { lastWaitMs: ms } };
  }
}
