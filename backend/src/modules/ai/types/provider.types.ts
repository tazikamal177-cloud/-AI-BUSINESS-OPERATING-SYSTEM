/**
 * AI Provider — contrat commun pour tous les fournisseurs d'IA.
 * Toute l'application ne parle qu'à cette interface.
 *
 * Implémenté par :
 *   - OpenAiProvider
 *   - AnthropicProvider
 *   - GeminiProvider
 *
 * Le gateway (AiGatewayService) gère le registre, le pricing, la normalisation
 * des erreurs et la mise en cache du catalogue de modèles.
 */

export type ProviderId = 'openai' | 'anthropic' | 'gemini';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** For assistant messages: tool calls emitted by the model. */
  toolCalls?: UnifiedToolCall[];
  /** For tool messages: the id of the tool call being replied to. */
  toolCallId?: string;
  /** Optional name for tool messages. */
  name?: string;
}

export interface ToolSpec {
  /** Stable name in the global tool registry. */
  name: string;
  description: string;
  /** JSON Schema for the input parameters. */
  inputSchema: Record<string, unknown>;
}

export interface UnifiedToolCall {
  id: string;
  name: string;
  /** Stringified JSON arguments (raw from the model). */
  arguments: string;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolSpec[];
  /** Provider-specific extras pass-through. */
  extras?: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface ChatResponse {
  content: string;
  toolCalls: UnifiedToolCall[];
  usage: TokenUsage;
  /** Raw provider response for debugging/audit. */
  raw?: unknown;
}

export interface StreamChunk {
  /** Incremental content delta. */
  content?: string;
  /** Incremental tool call delta (assembled by gateway). */
  toolCallDelta?: Partial<UnifiedToolCall> & { index: number };
  /** Final usage, only present in the last chunk. */
  usage?: TokenUsage;
  /** Set on the terminal chunk. */
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error';
}

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  /** Cost per 1M tokens (USD). */
  pricing: { input: number; output: number };
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsVision: boolean;
}

export interface EmbeddingModelInfo {
  id: string;
  name: string;
  dimensions: number;
}

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  chatModels: ModelInfo[];
  embeddingModels: EmbeddingModelInfo[];
}

/**
 * Common contract every AI provider must implement.
 * Throw `ProviderError` for recoverable errors; let other errors bubble.
 */
export interface AIProvider {
  readonly id: ProviderId;
  readonly name: string;

  /** Non-streaming chat completion. */
  chat(req: ChatRequest): Promise<ChatResponse>;

  /** Streaming chat completion. Yields chunks; final chunk carries usage. */
  chatStream(req: ChatRequest, onChunk: (chunk: StreamChunk) => void): Promise<ChatResponse>;

  /** Generate an embedding for a single text. */
  embed(text: string, model?: string): Promise<number[]>;

  /** Best-effort token estimation. Used for cost pre-checks & quota. */
  countTokens(text: string, model?: string): number;

  /** Catalogue of supported models and prices. */
  getInfo(): ProviderInfo;
}

/**
 * Recoverable error from a provider.
 * The runtime maps this to a typed API error.
 */
export class ProviderError extends Error {
  constructor(
    public readonly providerId: ProviderId,
    public readonly code:
      | 'rate_limited'
      | 'auth'
      | 'invalid_request'
      | 'context_too_long'
      | 'model_unavailable'
      | 'timeout'
      | 'unknown',
    message: string,
    public readonly retryable: boolean = false,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
