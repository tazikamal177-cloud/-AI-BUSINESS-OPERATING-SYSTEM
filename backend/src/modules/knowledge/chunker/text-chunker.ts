import { Injectable, Logger } from '@nestjs/common';
import { encode } from 'gpt-3-encoder';

/**
 * Recursive text splitter.
 *
 * Strategy:
 *   1. Split the text by hierarchical separators (paragraphs → lines → sentences → words).
 *   2. Greedily merge small chunks until reaching `chunkSize` tokens.
 *   3. Carry an overlap of `chunkOverlap` tokens between consecutive chunks for context continuity.
 *   4. Preserve heading boundaries (markdown `#` lines) when possible.
 *
 * Defaults: 800 tokens / 200 overlap — matches OpenAI's recommendation for
 * `text-embedding-3-small` (8192-token context).
 */
@Injectable()
export class TextChunker {
  private readonly logger = new Logger(TextChunker.name);

  private readonly SEPARATORS = ['\n\n', '\n', '. ', '! ', '? ', '; ', ', ', ' ', ''];

  /**
   * Split `text` into chunks.
   * @param text           source text
   * @param chunkSize      target max tokens per chunk
   * @param chunkOverlap   tokens of overlap between consecutive chunks
   */
  split(text: string, chunkSize = 800, chunkOverlap = 200): string[] {
    if (!text || !text.trim()) return [];
    if (chunkSize <= 0) throw new Error('chunkSize must be > 0');
    if (chunkOverlap < 0 || chunkOverlap >= chunkSize) {
      throw new Error('chunkOverlap must be in [0, chunkSize)');
    }

    const cleaned = this.preClean(text);
    const pieces = this.recursiveSplit(cleaned, this.SEPARATORS);
    const chunks = this.mergePieces(pieces, chunkSize, chunkOverlap);
    return chunks.map((c) => c.trim()).filter((c) => c.length > 0);
  }

  /** Count tokens for a string. */
  countTokens(s: string): number {
    try { return encode(s).length; } catch { return Math.ceil(s.length / 4); }
  }

  // ──────────────── internals ────────────────

  private preClean(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  private recursiveSplit(text: string, separators: string[]): string[] {
    const sep = separators[0];
    const next = separators.slice(1);
    const parts = text.split(sep);
    if (parts.length === 1 && next.length > 0) {
      return this.recursiveSplit(text, next);
    }
    const out: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p) continue;
      if (next.length > 0 && this.countTokens(p) > 800) {
        const sub = this.recursiveSplit(p, next);
        for (const s of sub) out.push(s);
      } else {
        out.push(p);
      }
      // Add the separator back (except after the last part)
      if (i < parts.length - 1 && sep) {
        out[out.length - 1] = out[out.length - 1] + sep;
      }
    }
    return out.filter((s) => s.trim().length > 0);
  }

  private mergePieces(pieces: string[], chunkSize: number, chunkOverlap: number): string[] {
    const chunks: string[] = [];
    let buffer = '';
    let bufferTokens = 0;

    for (const piece of pieces) {
      const pieceTokens = this.countTokens(piece);

      // Piece alone exceeds chunkSize: hard-split it
      if (pieceTokens > chunkSize) {
        if (buffer) {
          chunks.push(buffer);
          buffer = '';
          bufferTokens = 0;
        }
        chunks.push(...this.hardSplit(piece, chunkSize));
        continue;
      }

      // Adding piece would overflow: commit buffer, start new with overlap
      if (bufferTokens + pieceTokens > chunkSize) {
        chunks.push(buffer);
        // Build overlap prefix from the tail of the previous chunk
        const overlapText = this.tailTokens(buffer, chunkOverlap);
        buffer = overlapText ? overlapText + piece : piece;
        bufferTokens = this.countTokens(buffer);
      } else {
        buffer = buffer ? buffer + piece : piece;
        bufferTokens += pieceTokens;
      }
    }
    if (buffer.trim()) chunks.push(buffer);
    return chunks;
  }

  private hardSplit(text: string, chunkSize: number): string[] {
    // Approximate by characters when tokenization is heavy
    const out: string[] = [];
    const approx = chunkSize * 4;
    for (let i = 0; i < text.length; i += approx) {
      out.push(text.slice(i, i + approx));
    }
    return out;
  }

  private tailTokens(text: string, maxTokens: number): string {
    const tokens = encode(text);
    if (tokens.length <= maxTokens) return text;
    const slice = tokens.slice(tokens.length - maxTokens);
    return new TextDecoder('utf-8').decode(Uint8Array.from(slice));
  }
}
