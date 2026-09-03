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
  'gemini-1.5-pro': { input: 1.25, output: 5 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-1.0-pro': { input: 0.5, output: 1.5 },
  'text-embedding-004': { input: 0.025, output: 0 },
};

@Injectable()
export class GeminiProvider implements AIProvider {
  readonly id = 'gemini' as const;
  readonly name = 'Google Gemini';
  private apiKey: string;
  private readonly logger = new Logger(GeminiProvider.name);

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('GOOGLE_AI_API_KEY') ?? '';
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body = this.buildBody(req);
    const data = await this.callApi(req.model, body, false).catch((e) => { throw this.toProviderError(e); });
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const text = parts.filter((p: any) => typeof p.text === 'string').map((p: any) => p.text).join('');
    const toolCalls = parts
      .filter((p: any) => p.functionCall)
      .map((p: any, i: number) => ({
        id: `gemini-${Date.now()}-${i}`,
        name: p.functionCall.name,
        arguments: JSON.stringify(p.functionCall.args ?? {}),
      }));
    const usage = data.usageMetadata ?? {};
    return {
      content: text,
      toolCalls,
      usage: {
        inputTokens: usage.promptTokenCount ?? 0,
        outputTokens: usage.candidatesTokenCount ?? 0,
        totalTokens: usage.totalTokenCount ?? 0,
        estimatedCostUsd: this.cost(req.model, usage.promptTokenCount ?? 0, usage.candidatesTokenCount ?? 0),
      },
      raw: data,
    };
  }

  async chatStream(req: ChatRequest, onChunk: (c: StreamChunk) => void): Promise<ChatResponse> {
    const body = this.buildBody(req);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw this.toProviderError({ status: res.status, error: err });
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    const toolCalls: UnifiedToolCall[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: StreamChunk['finishReason'] = 'stop';

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
          const parts = ev.candidates?.[0]?.content?.parts ?? [];
          for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            if (typeof p.text === 'string' && p.text) {
              fullContent += p.text;
              onChunk({ content: p.text });
            }
            if (p.functionCall) {
              const tc: UnifiedToolCall = {
                id: `gemini-${Date.now()}-${toolCalls.length}`,
                name: p.functionCall.name,
                arguments: JSON.stringify(p.functionCall.args ?? {}),
              };
              toolCalls.push(tc);
              onChunk({ toolCallDelta: { index: toolCalls.length - 1, id: tc.id, name: tc.name, arguments: tc.arguments } });
            }
          }
          if (ev.usageMetadata) {
            inputTokens = ev.usageMetadata.promptTokenCount ?? inputTokens;
            outputTokens = ev.usageMetadata.candidatesTokenCount ?? outputTokens;
          }
          if (ev.candidates?.[0]?.finishReason) {
            finishReason = ev.candidates[0].finishReason === 'STOP' ? 'stop' : (ev.candidates[0].finishReason as any);
          }
        } catch {
          /* ignore */
        }
      }
    }
    const usage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCostUsd: this.cost(req.model, inputTokens, outputTokens),
    };
    onChunk({ usage, finishReason });
    return { content: fullContent, toolCalls, usage, raw: undefined };
  }

  async embed(text: string, model = 'text-embedding-004'): Promise<number[]> {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw this.toProviderError({ status: res.status, error: err });
    }
    const data = await res.json();
    return data.embedding?.values ?? [];
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  getInfo(): ProviderInfo {
    return {
      id: 'gemini',
      name: 'Google Gemini',
      chatModels: [
        { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', contextWindow: 1_000_000, pricing: PRICING['gemini-1.5-pro'], supportsTools: true, supportsStreaming: true, supportsVision: true },
        { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', contextWindow: 1_000_000, pricing: PRICING['gemini-1.5-flash'], supportsTools: true, supportsStreaming: true, supportsVision: true },
        { id: 'gemini-1.0-pro', name: 'Gemini 1.0 Pro', contextWindow: 32_000, pricing: PRICING['gemini-1.0-pro'], supportsTools: false, supportsStreaming: true, supportsVision: false },
      ],
      embeddingModels: [
        { id: 'text-embedding-004', name: 'Text Embedding 004', dimensions: 768 },
      ],
    };
  }

  // ──────────────── helpers ────────────────

  private buildBody(req: ChatRequest): any {
    const contents = this.toGeminiContents(req.messages);
    const body: any = {
      contents,
      generationConfig: {
        temperature: req.temperature ?? 0.7,
        maxOutputTokens: req.maxTokens ?? 4096,
      },
    };
    if (req.tools?.length) {
      body.tools = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: this.cleanSchemaForGemini(t.inputSchema),
          })),
        },
      ];
    }
    // system instruction
    const sys = req.messages.find((m) => m.role === 'system')?.content;
    if (sys) body.systemInstruction = { role: 'system', parts: [{ text: sys }] };
    return body;
  }

  private toGeminiContents(messages: ChatMessage[]): any[] {
    return messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'function',
            parts: [
              {
                functionResponse: {
                  name: m.name ?? 'tool',
                  response: this.safeJson(m.content),
                },
              },
            ],
          };
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
          return {
            role: 'model',
            parts: [
              ...(m.content ? [{ text: m.content }] : []),
              ...m.toolCalls.map((tc) => ({
                functionCall: { name: tc.name, args: this.safeJson(tc.arguments) },
              })),
            ],
          };
        }
        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        };
      });
  }

  /** Gemini doesn't accept { type: "object" } at root for function params. */
  private cleanSchemaForGemini(schema: any): any {
    if (!schema || typeof schema !== 'object') return schema;
    const out: any = { ...schema };
    delete out.type;
    if (out.properties) {
      out.properties = Object.fromEntries(
        Object.entries(out.properties).map(([k, v]: [string, any]) => [k, this.cleanSchemaForGemini(v)]),
      );
    }
    if (out.items) out.items = this.cleanSchemaForGemini(out.items);
    return out;
  }

  private async callApi(model: string, body: any, stream: boolean): Promise<any> {
    const url = stream
      ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`
      : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    const p = PRICING[model] ?? PRICING['gemini-1.5-pro'];
    return Math.round(((input / 1_000_000) * p.input + (output / 1_000_000) * p.output) * 1_000_000) / 1_000_000;
  }

  private toProviderError(e: any): ProviderError {
    const status = e?.status ?? e?.response?.status;
    const msg = e?.error?.error?.message ?? e?.error?.message ?? e?.message ?? 'Gemini error';
    if (status === 401 || status === 403) return new ProviderError('gemini', 'auth', msg, false, status);
    if (status === 429) return new ProviderError('gemini', 'rate_limited', msg, true, 429);
    if (status === 400 && /token|length/i.test(msg)) return new ProviderError('gemini', 'context_too_long', msg, false, 400);
    if (status === 404) return new ProviderError('gemini', 'model_unavailable', msg, false, 404);
    if (status >= 500) return new ProviderError('gemini', 'unknown', msg, true, status);
    return new ProviderError('gemini', 'invalid_request', msg, false, status);
  }
}
