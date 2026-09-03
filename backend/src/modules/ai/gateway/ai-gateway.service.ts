import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AIProvider, ProviderId, ProviderInfo, ChatRequest, ChatResponse, ModelInfo, StreamChunk } from '../types/provider.types';
import { OpenAiProvider } from '../providers/openai.provider';
import { AnthropicProvider } from '../providers/anthropic.provider';
import { GeminiProvider } from '../providers/gemini.provider';

@Injectable()
export class AiGatewayService implements OnModuleInit {
  private readonly logger = new Logger(AiGatewayService.name);
  private providers = new Map<ProviderId, AIProvider>();
  /** Default provider used for embeddings (Anthropic has none). */
  private readonly embedProvider: ProviderId = 'openai';

  constructor(
    private readonly openai: OpenAiProvider,
    private readonly anthropic: AnthropicProvider,
    private readonly gemini: GeminiProvider,
  ) {}

  onModuleInit() {
    this.providers.set('openai', this.openai);
    this.providers.set('anthropic', this.anthropic);
    this.providers.set('gemini', this.gemini);
    this.logger.log(`AI providers registered: ${[...this.providers.keys()].join(', ')}`);
  }

  /** Resolve a provider by id, with default fallback. */
  get(providerId?: ProviderId | string): AIProvider {
    const id = (providerId ?? 'openai') as ProviderId;
    const p = this.providers.get(id);
    if (!p) throw new Error(`AI provider "${id}" not available`);
    return p;
  }

  list(): ProviderInfo[] {
    return [...this.providers.values()].map((p) => p.getInfo());
  }

  /**
   * Resolve a (providerId, modelId) → ModelInfo, with sensible default.
   * Accepts either a "model" string in "provider:model" format or just "model".
   */
  resolveModel(provider: ProviderId | string, model: string): { provider: AIProvider; info: ModelInfo } {
    const p = this.get(provider);
    const info = p.getInfo().chatModels.find((m) => m.id === model);
    if (!info) throw new Error(`Model "${model}" not found in provider "${p.id}"`);
    return { provider: p, info };
  }

  /** Catalogue (for the admin/builder UI). */
  catalog() {
    return this.providers.entries();
  }

  // ──────────────── High-level operations ────────────────

  async chat(req: ChatRequest, providerHint?: ProviderId | string): Promise<ChatResponse> {
    // Determine provider from model if not explicit
    let providerId = providerHint as ProviderId | undefined;
    if (!providerId) {
      for (const p of this.providers.values()) {
        if (p.getInfo().chatModels.some((m) => m.id === req.model)) {
          providerId = p.id;
          break;
        }
      }
    }
    if (!providerId) {
      // Fall back to default
      providerId = 'openai';
    }
    const provider = this.get(providerId);
    return provider.chat({ ...req, model: req.model });
  }

  async chatStream(
    req: ChatRequest,
    onChunk: (c: StreamChunk) => void,
    providerHint?: ProviderId | string,
  ): Promise<ChatResponse> {
    let providerId = providerHint as ProviderId | undefined;
    if (!providerId) {
      for (const p of this.providers.values()) {
        if (p.getInfo().chatModels.some((m) => m.id === req.model)) {
          providerId = p.id;
          break;
        }
      }
    }
    const provider = this.get(providerId ?? 'openai');
    return provider.chatStream({ ...req, model: req.model }, onChunk);
  }

  /**
   * Embed a single text with fallback: if the chosen provider doesn't support
   * embeddings, route to the default embed provider (OpenAI by default).
   */
  async embed(text: string, providerId?: ProviderId | string, model?: string): Promise<number[]> {
    const id = (providerId ?? this.embedProvider) as ProviderId;
    const provider = this.get(id);
    try {
      return await provider.embed(text, model);
    } catch (e: any) {
      if (e?.code === 'invalid_request' && id !== this.embedProvider) {
        this.logger.warn(`Provider ${id} has no embeddings, falling back to ${this.embedProvider}`);
        return this.get(this.embedProvider).embed(text);
      }
      throw e;
    }
  }

  /**
   * Embed a batch of texts. Falls back to per-text calls if the provider's
   * embed method does not accept arrays (the AIProvider contract uses single
   * strings). For OpenAI, the underlying provider is expected to expose a
   * `embedMany` capability; otherwise we map over the array.
   */
  async embedBatch(texts: string[], providerId?: ProviderId | string, model?: string): Promise<number[][]> {
    if (texts.length === 0) return [];
    const id = (providerId ?? this.embedProvider) as ProviderId;
    const provider = this.get(id);
    // If the provider exposes a batch-capable method, use it (10× faster).
    const anyProvider = provider as unknown as { embedMany?: (texts: string[], model?: string) => Promise<number[][]> };
    if (typeof anyProvider.embedMany === 'function') {
      try {
        return await anyProvider.embedMany(texts, model);
      } catch (e: any) {
        if (e?.code === 'invalid_request' && id !== this.embedProvider) {
          this.logger.warn(`Provider ${id} has no embeddings, falling back to ${this.embedProvider}`);
          return (this.get(this.embedProvider) as any).embedMany
            ? (this.get(this.embedProvider) as any).embedMany(texts, model)
            : this.embedBatchFallback(texts, this.embedProvider, model);
        }
        throw e;
      }
    }
    return this.embedBatchFallback(texts, id, model);
  }

  private async embedBatchFallback(texts: string[], providerId: ProviderId, model?: string): Promise<number[][]> {
    const out: number[][] = [];
    for (const t of texts) {
      out.push(await this.embed(t, providerId, model));
    }
    return out;
  }
}
