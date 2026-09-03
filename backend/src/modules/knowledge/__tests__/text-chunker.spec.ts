import { Test } from '@nestjs/testing';
import { TextChunker } from '../chunker/text-chunker';

describe('TextChunker', () => {
  let chunker: TextChunker;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({ providers: [TextChunker] }).compile();
    chunker = mod.get(TextChunker);
  });

  it('returns [] on empty text', () => {
    expect(chunker.split('')).toEqual([]);
    expect(chunker.split('   \n  ')).toEqual([]);
  });

  it('returns a single chunk for short text', () => {
    const text = 'Hello world. This is a short test.';
    const chunks = chunker.split(text, 100, 10);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it('produces multiple chunks for long text with overlap', () => {
    const text = Array.from({ length: 2000 }, () => 'word').join(' ');
    const chunks = chunker.split(text, 200, 50);
    expect(chunks.length).toBeGreaterThan(1);
    // Overlap should cause the first words of chunk N+1 to appear at the end of chunk N
    const last = chunks[0].split(/\s+/).slice(-3).join(' ');
    expect(chunks[1]).toContain(last.split(' ')[0]);
  });

  it('respects chunkSize budget', () => {
    const text = 'Sentence one. Sentence two. Sentence three. Sentence four. Sentence five.';
    const chunks = chunker.split(text, 10, 2);
    for (const c of chunks) {
      expect(chunker.countTokens(c)).toBeLessThanOrEqual(20); // margin
    }
  });

  it('preserves paragraph boundaries when possible', () => {
    const text = 'Paragraph A.\n\nParagraph B.\n\nParagraph C.';
    const chunks = chunker.split(text, 100, 0);
    // Each paragraph should remain intact
    expect(chunks.join(' ')).toContain('Paragraph A.');
    expect(chunks.join(' ')).toContain('Paragraph B.');
    expect(chunks.join(' ')).toContain('Paragraph C.');
  });

  it('throws on invalid overlap', () => {
    expect(() => chunker.split('hello world', 100, 100)).toThrow();
    expect(() => chunker.split('hello world', 100, 200)).toThrow();
    expect(() => chunker.split('hello world', 0, 0)).toThrow();
  });

  it('countTokens returns > 0 for non-empty text', () => {
    expect(chunker.countTokens('')).toBe(0);
    expect(chunker.countTokens('hello')).toBeGreaterThan(0);
  });
});
