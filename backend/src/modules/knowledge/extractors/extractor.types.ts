/**
 * Extractor interface — each supported file type has an extractor.
 */
export interface ExtractedDocument {
  text: string;
  /** Optional metadata extracted from the source (page numbers, sheet names, etc.) */
  metadata?: Record<string, unknown>;
}

export interface ExtractorContext {
  buffer?: Buffer;
  /** For URL extractors */
  url?: string;
  /** Original filename (for extension sniffing) */
  filename: string;
  mimeType: string;
}

export interface Extractor {
  /** True if this extractor can handle the file. */
  supports(ctx: ExtractorContext): boolean;
  extract(ctx: ExtractorContext): Promise<ExtractedDocument>;
}
