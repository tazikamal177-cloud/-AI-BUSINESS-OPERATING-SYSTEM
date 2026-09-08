/**
 * AgentRuntimeService — coverage tests.
 *
 * Protocol (per CRITIQUE 5 of the audit):
 *   - Write the tests FIRST, run them.
 *   - If a defect is revealed, document it as a NEW CRITIQUE (do not
 *     silently fix it inside this commit).
 *
 * The runtime has 7 dependencies (Prisma, AI gateway, tool executor,
 * memory, RAG, usage, quota, audit). We stub all of them with in-memory
 * fakes that expose just enough surface to exercise each branch.
 *
 * Branches covered (11):
 *   1. agent not found
 *   2. agent archived
 *   3. agent DRAFT without dryRun
 *   4. agent DRAFT with dryRun  (allowed)
 *   5. quota exceeded
 *   6. RAG retrieval failure
 *   7. response without tool calls
 *   8. response with tool calls (success)
 *   9. tool requires approval (HITL)
 *  10. tool execution failure
 *  11. provider error
 *  12. event ordering (start → deltas → tool.* → done)
 *  13. dryRun skips persistence
 */
import { AgentRuntimeService, AgentRunContext } from '../agent-runtime.service';
import { ProviderError } from '../../ai/types/provider.types';

// ───────────────────────── fakes ─────────────────────────

class FakePrisma {
  // The runtime reads `prisma.agent.findFirst`, `prisma.message.create`, etc.
  // We expose model "tables" as properties that contain the prisma methods.
  // Tests set `prisma._agent` to control what `findFirst` returns, without
  // overwriting the model object itself.
  _agent: any = null;
  _messages: any[] = [];
  agent: { findFirst: jest.Mock };
  message: { create: jest.Mock; findMany: jest.Mock };

  constructor() {
    this.agent = {
      findFirst: jest.fn(async () => this._agent),
    };
    this.message = {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `msg-${this._messages.length + 1}`, ...data };
        this._messages.push(row);
        return row;
      }),
      findMany: jest.fn(async () =>
        this._messages
          .filter((m) => m.conversationId === 'conv-1')
          .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
      ),
    };
  }
}

class FakeGateway {
  countTokens = jest.fn((s: string) => Math.ceil(s.length / 4));
  chatStream = jest.fn();
  chat = jest.fn();
  get = jest.fn(() => this);
}

class FakeToolExec {
  buildSpecsForAgent = jest.fn(async () => []);
  execute = jest.fn(async () => ({
    toolCallId: 'tc1', toolName: 'fake', ok: true, output: { x: 1 }, durationMs: 5,
  }));
}

class FakeMemory {
  pushShortTerm = jest.fn(async () => undefined);
}

class FakeRag {
  retrieve = jest.fn(async () => []);
  buildContext = jest.fn(() => '');
}

class FakeUsage {
  record = jest.fn(async () => undefined);
}

class FakeQuota {
  enforce = jest.fn(async () => ({ allowed: true, status: { used: 0, limit: 1_000_000 } }));
}

class FakeAudit {
  log = jest.fn(async () => undefined);
}

function makeService(overrides: {
  prisma?: any; gateway?: any; toolExec?: any; memory?: any; rag?: any;
  usage?: any; quota?: any; audit?: any;
} = {}) {
  const prisma = overrides.prisma ?? new FakePrisma();
  const gateway = overrides.gateway ?? new FakeGateway();
  const toolExec = overrides.toolExec ?? new FakeToolExec();
  const memory = overrides.memory ?? new FakeMemory();
  const rag = overrides.rag ?? new FakeRag();
  const usage = overrides.usage ?? new FakeUsage();
  const quota = overrides.quota ?? new FakeQuota();
  const audit = overrides.audit ?? new FakeAudit();
  const svc = new AgentRuntimeService(
    prisma as any, gateway as any, toolExec as any, memory as any,
    rag as any, usage as any, quota as any, audit as any,
  );
  return { svc, prisma, gateway, toolExec, memory, rag, usage, quota, audit };
}

const baseCtx: AgentRunContext = {
  organizationId: 'org-1',
  userId: 'user-1',
  agentId: 'agent-1',
  conversationId: 'conv-1',
  message: 'Hello',
};

const baseAgent = (overrides: any = {}) => ({
  id: 'agent-1',
  organizationId: 'org-1',
  name: 'Test agent',
  systemInstructions: 'You are a test agent.',
  modelProvider: 'openai',
  modelName: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 4096,
  status: 'ACTIVE',
  deletedAt: null,
  agentTools: [],
  agentKnowledge: [],
  ...overrides,
});

// ───────────────────────── tests ─────────────────────────

describe('AgentRuntimeService.run — branch coverage', () => {
  it('1. throws NotFoundException when the agent does not exist', async () => {
    const { svc, prisma } = makeService();
    prisma._agent =null;
    await expect(svc.run(baseCtx)).rejects.toThrow(/Agent not found/);
  });

  it('2. rejects when the agent is ARCHIVED', async () => {
    const { svc, prisma } = makeService();
    prisma._agent =baseAgent({ status: 'ARCHIVED' });
    await expect(svc.run(baseCtx)).rejects.toThrow(/archived/i);
  });

  it('3. rejects a DRAFT agent when dryRun is false', async () => {
    const { svc, prisma } = makeService();
    prisma._agent =baseAgent({ status: 'DRAFT' });
    await expect(svc.run(baseCtx)).rejects.toThrow(/not active/i);
  });

  it('4. allows a DRAFT agent when dryRun is true (used by /test endpoint)', async () => {
    const { svc, prisma, gateway, usage, memory } = makeService();
    prisma._agent =baseAgent({ status: 'DRAFT' });
    gateway.chatStream = jest.fn(async () => ({
      content: 'pong',
      toolCalls: [],
      usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7, estimatedCostUsd: 0.0001 },
    }));
    const result = await svc.run({ ...baseCtx, dryRun: true });
    expect(result.content).toBe('pong');
    // Persistence skipped
    expect(usage.record).not.toHaveBeenCalled();
    expect(memory.pushShortTerm).not.toHaveBeenCalled();
  });

  it('5. throws QUOTA_EXCEEDED when the quota service refuses', async () => {
    const { svc, prisma, quota } = makeService();
    prisma._agent = baseAgent();
    quota.enforce = jest.fn(async () => ({
      allowed: false,
      reason: 'Monthly quota reached',
      status: { used: 1_000_000, limit: 1_000_000 },
    }));
    let caught: any;
    try { await svc.run(baseCtx); } catch (e) { caught = e; }
    expect(caught).toBeDefined();
    // NestJS BadRequestException with object payload puts the object under .response
    const body = typeof caught.getResponse === 'function' ? caught.getResponse() : caught;
    expect(body?.code).toBe('QUOTA_EXCEEDED');
  });

  it('6. does not crash when RAG retrieval fails (warning logged, citations=[])', async () => {
    const { svc, prisma, gateway, rag } = makeService();
    prisma._agent =baseAgent();
    rag.retrieve = jest.fn(async () => { throw new Error('vector index not ready'); });
    gateway.chatStream = jest.fn(async () => ({
      content: 'no-rag-answer',
      toolCalls: [],
      usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7, estimatedCostUsd: 0 },
    }));
    const result = await svc.run(baseCtx);
    expect(result.content).toBe('no-rag-answer');
    expect(result.citations).toEqual([]);
  });

  it('7. breaks the loop when the model returns no tool calls', async () => {
    const { svc, prisma, gateway, toolExec } = makeService();
    prisma._agent =baseAgent();
    gateway.chatStream = jest.fn(async () => ({
      content: 'just-an-answer',
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0 },
    }));
    const result = await svc.run(baseCtx);
    expect(result.content).toBe('just-an-answer');
    expect(result.toolCalls).toEqual([]);
    expect(toolExec.execute).not.toHaveBeenCalled();
  });

  it('8. executes tool calls and feeds results back to the model', async () => {
    const { svc, prisma, gateway, toolExec } = makeService();
    prisma._agent =baseAgent();
    // First call returns a tool call, second call returns the final answer
    let n = 0;
    gateway.chatStream = jest.fn(async () => {
      n++;
      if (n === 1) {
        return {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'get_weather', arguments: '{"city":"Paris"}' }],
          usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10, estimatedCostUsd: 0 },
        };
      }
      return {
        content: 'It is sunny in Paris.',
        toolCalls: [],
        usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17, estimatedCostUsd: 0 },
      };
    });
    const result = await svc.run(baseCtx);
    expect(toolExec.execute).toHaveBeenCalledTimes(1);
    expect(result.content).toBe('It is sunny in Paris.');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('get_weather');
    expect(result.toolCalls[0].ok).toBe(true);
  });

  it('9. marks a tool as PENDING_APPROVAL when the tool executor signals requiresApproval', async () => {
    const { svc, prisma, gateway, toolExec } = makeService();
    prisma._agent =baseAgent();
    toolExec.execute = jest.fn(async () => ({
      toolCallId: 'tc1', toolName: 'send_email', ok: false, blocked: true,
      requiresApproval: true, taskId: 'task-42', blockReason: 'HIGH risk',
      durationMs: 5,
    }));
    gateway.chatStream = jest.fn(async () => {
      // First call: tool call. Second call: final answer that references the pending approval.
      const callCount = gateway.chatStream.mock.calls.length;
      if (callCount === 1) {
        return {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'send_email', arguments: '{}' }],
          usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10, estimatedCostUsd: 0 },
        };
      }
      return {
        content: 'I have queued the email for approval.',
        toolCalls: [],
        usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17, estimatedCostUsd: 0 },
      };
    });
    const result = await svc.run(baseCtx);
    expect(result.toolCalls[0].requiresApproval).toBe(true);
    expect(result.toolCalls[0].taskId).toBe('task-42');
  });

  it('10. records a tool error in the result when the tool fails', async () => {
    const { svc, prisma, gateway, toolExec } = makeService();
    prisma._agent =baseAgent();
    toolExec.execute = jest.fn(async () => ({
      toolCallId: 'tc1', toolName: 'broken_tool', ok: false, error: 'kaboom',
      durationMs: 1,
    }));
    gateway.chatStream = jest.fn(async () => {
      const callCount = gateway.chatStream.mock.calls.length;
      if (callCount === 1) {
        return {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'broken_tool', arguments: '{}' }],
          usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1, estimatedCostUsd: 0 },
        };
      }
      return {
        content: 'The tool failed.',
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0 },
      };
    });
    const result = await svc.run(baseCtx);
    expect(result.toolCalls[0].ok).toBe(false);
    expect(result.toolCalls[0].error).toBe('kaboom');
  });

  it('11. captures ProviderError and returns a model error envelope', async () => {
    const { svc, prisma, gateway } = makeService();
    prisma._agent =baseAgent();
    gateway.chatStream = jest.fn(async () => {
      throw new ProviderError('openai', 'rate_limited', '429', true, 429);
    });
    const result = await svc.run(baseCtx);
    expect(result.content).toBe('');
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe('PROVIDER_RATE_LIMITED');
  });

  it('12. emits events in the expected order', async () => {
    const { svc, prisma, gateway } = makeService();
    prisma._agent =baseAgent();
    gateway.chatStream = jest.fn(async (_req: any, onChunk: any) => {
      onChunk({ content: 'hello ' });
      onChunk({ content: 'world' });
      return {
        content: 'hello world',
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, estimatedCostUsd: 0 },
      };
    });
    const events: any[] = [];
    await svc.run(baseCtx, (e) => events.push(e.type));
    expect(events).toEqual([
      'message.start',
      'message.delta',  // 'hello '
      'message.delta',  // 'world'
      'message.done',
    ]);
  });

  it('13. records usage only when not dryRun AND tokens > 0', async () => {
    const { svc, prisma, gateway, usage } = makeService();
    prisma._agent =baseAgent();
    gateway.chatStream = jest.fn(async () => ({
      content: 'ok',
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
    }));
    await svc.run(baseCtx);
    expect(usage.record).not.toHaveBeenCalled();
  });
});
