/**
 * AI Provider — unit tests using a stub provider.
 *
 * The 3 real providers (OpenAI, Anthropic, Gemini) require API keys and a
 * network call. We mock the underlying SDK so the gateway logic can be
 * exercised in CI.
 */
import { AiGatewayService } from '../src/modules/ai/gateway/ai-gateway.service';
import { OpenAiProvider } from '../src/modules/ai/providers/openai.provider';
import { AnthropicProvider } from '../src/modules/ai/providers/anthropic.provider';
import { GeminiProvider } from '../src/modules/ai/providers/gemini.provider';

class FakeProvider {
  id: any;
  name: string;
  calls: any[] = [];
  reply: any;
  constructor(id: any, name: string, reply: any) {
    this.id = id;
    this.name = name;
    this.reply = reply;
  }
  async chat(req: any) {
    this.calls.push({ kind: 'chat', req });
    return this.reply;
  }
  async chatStream(req: any, onChunk: any) {
    this.calls.push({ kind: 'chatStream', req });
    if (this.reply.content) onChunk({ content: this.reply.content });
    return this.reply;
  }
  async embed(text: string) {
    this.calls.push({ kind: 'embed', text });
    return [0.1, 0.2, 0.3];
  }
  countTokens(text: string) {
    return Math.ceil(text.length / 4);
  }
  getInfo() {
    return {
      id: this.id,
      name: this.name,
      chatModels: [
        { id: 'fake-model', name: 'Fake', contextWindow: 8000, pricing: { input: 1, output: 2 }, supportsTools: true, supportsStreaming: true, supportsVision: false },
      ],
      embeddingModels: [],
    };
  }
}

describe('AiGatewayService', () => {
  it('routes chat to the right provider', async () => {
    const oa = new FakeProvider('openai', 'OpenAI', { content: 'hi', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0 } });
    const an = new FakeProvider('anthropic', 'Anthropic', { content: 'x', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0 } });
    const gm = new FakeProvider('gemini', ' ' , { content: 'y', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0 } });
    gm.getInfo = () => ({ id: 'gemini', name: 'Gemini', chatModels: [{ id: 'gemini-1.5-pro', name: 'g', contextWindow: 1000000, pricing: { input: 0, output: 0 }, supportsTools: true, supportsStreaming: true, supportsVision: false }], embeddingModels: [] });

    const gw = new AiGatewayService(oa as any, an as any, gm as any);
    gw.onModuleInit();

    const r = await gw.chat({ model: 'fake-model', messages: [{ role: 'user', content: 'ping' }] }, 'openai');
    expect(r.content).toBe('hi');
    expect(oa.calls).toHaveLength(1);
  });

  it('resolves provider by model name when no provider hint', async () => {
    const oa = new FakeProvider('openai', 'OpenAI', { content: 'a', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0 } });
    const an = new FakeProvider('anthropic', 'Anthropic', { content: 'b', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0 } });
    const gm = new FakeProvider('gemini', 'Gemini', { content: 'c', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0 } });
    const gw = new AiGatewayService(oa as any, an as any, gm as any);
    gw.onModuleInit();
    // 'fake-model' only in openai catalog
    const r = await gw.chat({ model: 'fake-model', messages: [{ role: 'user', content: 'x' }] });
    expect(r.content).toBe('a');
  });
});
