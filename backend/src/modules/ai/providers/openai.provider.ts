import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  AIProvider,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ProviderError,
  ProviderInfo,
  StreamChunk,
  TokenUsage,
  ToolSpec,
  UnifiedToolCall,
} from '../types/provider.types';

const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'o1-preview': { input: 15, output: 60 },
  'o1-mini': { input: 3, output: 12 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
};

@Injectable()
export class OpenAiProvider implements AIProvider {
  readonly id = 'openai' as const;
  readonly name = 'OpenAI';
  private client: OpenAI;
  private readonly logger = new Logger(OpenAiProvider.name);

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    this.client = new OpenAI({ apiKey });
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const params: any = {
      model: req.model,
      messages: this.formatMessages(req.messages),
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 4096,
    };
    if (req.tools?.length) {
      params.tools = req.tools.map((t) => this.toOpenAITool(t));
      params.tool_choice = 'auto';
    }

    try {
      const response = await this.client.chat.completions.create(params);
      const message = response.choices[0]?.message;
      const usage = response.usage;
      return {
        content: message?.content ?? '',
        toolCalls:
          message?.tool_calls?.map((tc: any) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          })) ?? [],
        usage: {
          inputTokens: usage?.prompt_tokens ?? 0,
          outputTokens: usage?.completion_tokens ?? 0,
          totalTokens: usage?.total_tokens ?? 0,
          estimatedCostUsd: this.cost(req.model, usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0),
        },
        raw: response,
      };
    } catch (e: any) {
      throw this.toProviderError(e);
    }
  }

  async chatStream(req: ChatRequest, onChunk: (c: StreamChunk) => void): Promise<ChatResponse> {
    const params: any = {
      model: req.model,
      messages: this.formatMessages(req.messages),
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 4096,
      stream: true,
    };
    if (req.tools?.length) {
      params.tools = req.tools.map((t) => this.toOpenAITool(t));
      params.tool_choice = 'auto';
    }
    params.stream_options = { include_usage: true };

    const stream = await this.client.chat.completions.create(params).catch((e) => {
      throw this.toProviderError(e);
    });

    let fullContent = '';
    const toolCalls: UnifiedToolCall[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: StreamChunk['finishReason'] = 'stop';

    for await (const chunk of stream as any) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        fullContent += delta.content;
        onChunk({ content: delta.content });
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCalls[idx]) {
            toolCalls[idx] = { id: tc.id ?? '', name: '', arguments: '' };
          }
          if (tc.id) toolCalls[idx].id = tc.id;
          if (tc.function?.name) toolCalls[idx].name += tc.function.name;
          if (tc.function?.arguments) toolCalls[idx].arguments += tc.function.arguments;
          onChunk({ toolCallDelta: { index: idx, id: tc.id, name: tc.function?.name, arguments: tc.function?.arguments } });
        }
      }
      if (chunk.choices[0]?.finish_reason) {
        finishReason = chunk.choices[0].finish_reason === 'tool_calls' ? 'tool_calls' : (chunk.choices[0].finish_reason as any);
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
        outputTokens = chunk.usage.completion_tokens ?? outputTokens;
      }
    }

    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCostUsd: this.cost(req.model, inputTokens, outputTokens),
    };
    onChunk({ usage, finishReason });

    return { content: fullContent, toolCalls: toolCalls.filter(Boolean), usage, raw: undefined };
  }

  async embed(text: string, model = 'text-embedding-3-small'): Promise<number[]> {
    try {
      const res = await this.client.embeddings.create({ model, input: text });
      return res.data[0].embedding;
    } catch (e: any) {
      throw this.toProviderError(e);
    }
  }

  /**
   * Batch embeddings: OpenAI supports up to 2048 inputs per request.
   * Chunks the array into 100-input sub-batches and flattens the results.
   */
  async embedMany(texts: string[], model = 'text-embedding-3-small'): Promise<number[][]> {
    if (texts.length === 0) return [];
    const BATCH = 100;
    const out: number[][] = [];
    try {
      for (let i = 0; i < texts.length; i += BATCH) {
        const slice = texts.slice(i, i + BATCH);
        const res = await this.client.embeddings.create({ model, input: slice });
        for (const item of res.data) out.push(item.embedding as number[]);
      }
      return out;
    } catch (e: any) {
      throw this.toProviderError(e);
    }
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  getInfo(): ProviderInfo {
    return {
      id: 'openai',
      name: 'OpenAI',
      chatModels: [
        { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128_000, pricing: PRICING['gpt-4o'], supportsTools: true, supportsStreaming: true, supportsVision: true },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128_000, pricing: PRICING['gpt-4o-mini'], supportsTools: true, supportsStreaming: true, supportsVision: true },
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextWindow: 128_000, pricing: PRICING['gpt-4-turbo'], supportsTools: true, supportsStreaming: true, supportsVision: true },
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', contextWindow: 16_000, pricing: PRICING['gpt-3.5-turbo'], supportsTools: true, supportsStreaming: true, supportsVision: false },
        { id: 'o1-preview', name: 'o1 Preview', contextWindow: 128_000, pricing: PRICING['o1-preview'], supportsTools: false, supportsStreaming: false, supportsVision: false },
        { id: 'o1-mini', name: 'o1 Mini', contextWindow: 128_000, pricing: PRICING['o1-mini'], supportsTools: false, supportsStreaming: false, supportsVision: false },
      ],
      embeddingModels: [
        { id: 'text-embedding-3-small', name: 'Text Embedding 3 Small', dimensions: 1536 },
        { id: 'text-embedding-3-large', name: 'Text Embedding 3 Large', dimensions: 3072 },
      ],
    };
  }

  // ──────────────── helpers ────────────────

  private formatMessages(messages: ChatMessage[]): any[] {
    return messages.map((m) => {
      const msg: any = { role: m.role, content: m.content };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      if (m.toolCallId) msg.tool_call_id = m.toolCallId;
      return msg;
    });
  }

  private toOpenAITool(t: ToolSpec) {
    return {
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    };
  }

  private cost(model: string, input: number, output: number): number {
    const p = PRICING[model] ?? PRICING['gpt-4o-mini'];
    return Math.round(((input / 1_000_000) * p.input + (output / 1_000_000) * p.output) * 1_000_000) / 1_000_000;
  }

  private toProviderError(e: any): ProviderError {
    const status = e?.status ?? e?.response?.status;
    const msg = e?.error?.message ?? e?.message ?? 'OpenAI error';
    if (status === 401) return new ProviderError('openai', 'auth', msg, false, 401);
    if (status === 429) return new ProviderError('openai', 'rate_limited', msg, true, 429);
    if (status === 400 && /context|length/i.test(msg)) return new ProviderError('openai', 'context_too_long', msg, false, 400);
    if (status === 404) return new ProviderError('openai', 'model_unavailable', msg, false, 404);
    if (status >= 500) return new ProviderError('openai', 'unknown', msg, true, status);
    return new ProviderError('openai', 'invalid_request', msg, false, status);
  }
}
