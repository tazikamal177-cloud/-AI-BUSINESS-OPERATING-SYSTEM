import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AIProvider,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ProviderError,
  ProviderInfo,
  StreamChunk,
  ToolSpec,
  UnifiedToolCall,
} from '../types/provider.types';

const PRICING: Record<string, { input: number; output: number }> = {
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'claude-3-5-sonnet-latest': { input: 3, output: 15 },
  'claude-3-5-haiku-20241022': { input: 0.25, output: 1.25 },
  'claude-3-opus-20240229': { input: 15, output: 75 },
  'claude-3-sonnet-20240229': { input: 3, output: 15 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
};

@Injectable()
export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic' as const;
  readonly name = 'Anthropic';
  private apiKey: string;
  private readonly logger = new Logger(AnthropicProvider.name);

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('ANTHROPIC_API_KEY') ?? '';
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const { system, messages } = this.splitSystem(req.messages);
    const body: any = {
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
      system: system ?? undefined,
      messages: this.toAnthropicMessages(messages, req.tools),
    };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }

    const data = await this.callApi(body).catch((e) => { throw this.toProviderError(e); });

    const textBlocks = (data.content ?? []).filter((b: any) => b.type === 'text');
    const toolUseBlocks = (data.content ?? []).filter((b: any) => b.type === 'tool_use');

    return {
      content: textBlocks.map((b: any) => b.text).join(''),
      toolCalls: toolUseBlocks.map((b: any) => ({
        id: b.id,
        name: b.name,
        arguments: JSON.stringify(b.input ?? {}),
      })),
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
        estimatedCostUsd: this.cost(req.model, data.usage?.input_tokens ?? 0, data.usage?.output_tokens ?? 0),
      },
      raw: data,
    };
  }

  async chatStream(req: ChatRequest, onChunk: (c: StreamChunk) => void): Promise<ChatResponse> {
    const { system, messages } = this.splitSystem(req.messages);
    const body: any = {
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
      system: system ?? undefined,
      messages: this.toAnthropicMessages(messages, req.tools),
      stream: true,
    };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok || !response.body) {
      const err = await response.json().catch(() => ({}));
      throw this.toProviderError({ status: response.status, error: err });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    const toolCalls: UnifiedToolCall[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let currentToolJson = '';
    let stopReason: StreamChunk['finishReason'] = 'stop';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const ev = JSON.parse(payload);
          switch (ev.type) {
            case 'message_start':
              inputTokens = ev.message?.usage?.input_tokens ?? inputTokens;
              break;
            case 'content_block_start':
              if (ev.content_block?.type === 'tool_use') {
                toolCalls.push({ id: ev.content_block.id, name: ev.content_block.name, arguments: '' });
                currentToolJson = '';
              }
              break;
            case 'content_block_delta':
              if (ev.delta?.type === 'text_delta' && ev.delta.text) {
                fullContent += ev.delta.text;
                onChunk({ content: ev.delta.text });
              } else if (ev.delta?.type === 'input_json_delta' && ev.delta.partial_json) {
                currentToolJson += ev.delta.partial_json;
                if (toolCalls.length) {
                  toolCalls[toolCalls.length - 1].arguments = currentToolJson;
                  onChunk({ toolCallDelta: { index: toolCalls.length - 1, arguments: ev.delta.partial_json } });
                }
              }
              break;
            case 'content_block_stop':
              currentToolJson = '';
              break;
            case 'message_delta':
              outputTokens = ev.usage?.output_tokens ?? outputTokens;
              if (ev.delta?.stop_reason) {
                stopReason = ev.delta.stop_reason === 'tool_use' ? 'tool_calls' : (ev.delta.stop_reason as any);
              }
              break;
          }
        } catch {
          /* ignore malformed lines */
        }
      }
    }

    const usage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCostUsd: this.cost(req.model, inputTokens, outputTokens),
    };
    onChunk({ usage, finishReason: stopReason });

    return { content: fullContent, toolCalls, usage, raw: undefined };
  }

  async embed(_text: string): Promise<number[]> {
    // Anthropic has no native embeddings API — fall back is handled by the gateway.
    throw new ProviderError('anthropic', 'invalid_request', 'Anthropic has no embeddings API. Use OpenAI.', false);
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  getInfo(): ProviderInfo {
    return {
      id: 'anthropic',
      name: 'Anthropic',
      chatModels: [
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', contextWindow: 200_000, pricing: PRICING['claude-3-5-sonnet-20241022'], supportsTools: true, supportsStreaming: true, supportsVision: true },
        { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet (latest)', contextWindow: 200_000, pricing: PRICING['claude-3-5-sonnet-latest'], supportsTools: true, supportsStreaming: true, supportsVision: true },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', contextWindow: 200_000, pricing: PRICING['claude-3-5-haiku-20241022'], supportsTools: true, supportsStreaming: true, supportsVision: false },
        { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', contextWindow: 200_000, pricing: PRICING['claude-3-opus-20240229'], supportsTools: true, supportsStreaming: true, supportsVision: true },
        { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', contextWindow: 200_000, pricing: PRICING['claude-3-haiku-20240307'], supportsTools: true, supportsStreaming: true, supportsVision: false },
      ],
      embeddingModels: [],
    };
  }

  // ──────────────── helpers ────────────────

  private splitSystem(messages: ChatMessage[]): { system?: string; messages: ChatMessage[] } {
    const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n').trim();
    return { system: sys || undefined, messages: messages.filter((m) => m.role !== 'system') };
  }

  private toAnthropicMessages(messages: ChatMessage[], tools?: ToolSpec[]): any[] {
    const out: any[] = [];
    for (const m of messages) {
      if (m.role === 'user') {
        out.push({ role: 'user', content: m.content });
      } else if (m.role === 'assistant') {
        if (m.toolCalls?.length) {
          out.push({
            role: 'assistant',
            content: [
              ...(m.content ? [{ type: 'text', text: m.content }] : []),
              ...m.toolCalls.map((tc) => ({
                type: 'tool_use',
                id: tc.id,
                name: tc.name,
                input: this.safeJson(tc.arguments),
              })),
            ],
          });
        } else {
          out.push({ role: 'assistant', content: m.content });
        }
      } else if (m.role === 'tool') {
        out.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: m.toolCallId,
              content: m.content,
            },
          ],
        });
      }
    }
    return out;
  }

  private async callApi(body: any): Promise<any> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw { status: res.status, error: err };
    }
    return res.json();
  }

  private safeJson(s: string): any {
    try { return JSON.parse(s); } catch { return {}; }
  }

  private cost(model: string, input: number, output: number): number {
    const p = PRICING[model] ?? PRICING['claude-3-5-sonnet-20241022'];
    return Math.round(((input / 1_000_000) * p.input + (output / 1_000_000) * p.output) * 1_000_000) / 1_000_000;
  }

  private toProviderError(e: any): ProviderError {
    const status = e?.status ?? e?.response?.status;
    const msg = e?.error?.error?.message ?? e?.error?.message ?? e?.message ?? 'Anthropic error';
    if (status === 401) return new ProviderError('anthropic', 'auth', msg, false, 401);
    if (status === 429) return new ProviderError('anthropic', 'rate_limited', msg, true, 429);
    if (status === 400 && /context|length|too long/i.test(msg)) return new ProviderError('anthropic', 'context_too_long', msg, false, 400);
    if (status === 404) return new ProviderError('anthropic', 'model_unavailable', msg, false, 404);
    if (status >= 500) return new ProviderError('anthropic', 'unknown', msg, true, status);
    return new ProviderError('anthropic', 'invalid_request', msg, false, status);
  }
}
