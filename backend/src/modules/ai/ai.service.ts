import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiGatewayService } from './gateway/ai-gateway.service';
import {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ProviderId,
  ToolSpec,
} from './types/provider.types';

// ─────────────────────── Public types (re-exports for compatibility) ───────────────────────

export type { ChatMessage as AiMessage, ChatResponse as AiChatResponse, UnifiedToolCall } from './types/provider.types';

export interface AiChatOptions {
  model?: string;
  provider?: ProviderId | string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolSpec[];
  stream?: boolean;
}

// ─────────────────────── AiService (legacy facade over the gateway) ───────────────────────

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly gateway: AiGatewayService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Non-streaming chat.
   */
  async chat(
    messages: ChatMessage[],
    options: AiChatOptions = {},
  ): Promise<ChatResponse> {
    const req = this.buildRequest(messages, options);
    return this.gateway.chat(req, options.provider);
  }

  /**
   * Streaming chat.
   */
  async chatStream(
    messages: ChatMessage[],
    options: AiChatOptions,
    onChunk: (chunk: string) => void,
  ): Promise<ChatResponse> {
    const req = this.buildRequest(messages, options);
    return this.gateway.chatStream(req, (c) => { if (c.content) onChunk(c.content); }, options.provider);
  }

  /** Embed text (auto-fallback if provider has no embedding API). */
  async embed(text: string, provider?: ProviderId | string): Promise<number[]> {
    return this.gateway.embed(text, provider);
  }

  async countTokens(text: string, provider?: ProviderId | string): Promise<number> {
    return this.gateway.get(provider).countTokens(text);
  }

  /** Catalogue of all available providers & models. */
  getAvailableModels() {
    return this.gateway.list().reduce<Record<string, any>>((acc, p) => {
      acc[p.id] = p;
      return acc;
    }, {});
  }

  // ──────────────── helpers ────────────────

  private buildRequest(messages: ChatMessage[], options: AiChatOptions): ChatRequest {
    const model = options.model ?? (this.config.get('DEFAULT_AI_MODEL') as string) ?? 'gpt-4o-mini';
    if (!options.provider && !this.gateway.list().some((p) => p.chatModels.some((m) => m.id === model))) {
      // Allow but warn
      this.logger.warn(`Model ${model} not in any registered provider catalog — relying on provider fallback`);
    }
    return {
      messages,
      model,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 4096,
      tools: options.tools,
    };
  }
}
