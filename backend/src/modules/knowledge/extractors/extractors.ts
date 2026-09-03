import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ExtractedDocument, Extractor, ExtractorContext } from './extractor.types';
import pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';
import * as cheerio from 'cheerio';

/**
 * PDF extractor. Returns the full text plus a `pages` count metadata.
 */
@Injectable()
export class PdfExtractor implements Extractor {
  private readonly logger = new Logger(PdfExtractor.name);

  supports(ctx: ExtractorContext): boolean {
    return ctx.mimeType === 'application/pdf' || /\.pdf$/i.test(ctx.filename);
  }

  async extract(ctx: ExtractorContext): Promise<ExtractedDocument> {
    if (!ctx.buffer) throw new BadRequestException('PDF extraction requires a buffer');
    const data = await pdfParse(ctx.buffer);
    return {
      text: this.cleanText(data.text),
      metadata: {
        pages: data.numpages,
        info: data.info,
      },
    };
  }

  private cleanText(s: string): string {
    return s
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }
}

/**
 * DOCX extractor via mammoth.
 */
@Injectable()
export class DocxExtractor implements Extractor {
  supports(ctx: ExtractorContext): boolean {
    return (
      ctx.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      /\.docx$/i.test(ctx.filename)
    );
  }

  async extract(ctx: ExtractorContext): Promise<ExtractedDocument> {
    if (!ctx.buffer) throw new BadRequestException('DOCX extraction requires a buffer');
    const result = await mammoth.extractRawText({ buffer: ctx.buffer });
    return {
      text: this.clean(result.value),
      metadata: { messages: result.messages.map((m) => m.type) },
    };
  }

  private clean(s: string): string {
    return s.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
}

/**
 * Plain-text + Markdown extractor.
 */
@Injectable()
export class TextExtractor implements Extractor {
  supports(ctx: ExtractorContext): boolean {
    if (
      ctx.mimeType === 'text/plain' ||
      ctx.mimeType === 'text/markdown' ||
      ctx.mimeType.startsWith('text/')
    ) return true;
    return /\.(txt|md|markdown|log|json|ya?ml|xml|html|htm|css|js|ts|py|java|c|cpp|h|hpp|go|rs|rb|php|sh|sql)$/i.test(ctx.filename);
  }

  async extract(ctx: ExtractorContext): Promise<ExtractedDocument> {
    if (!ctx.buffer) throw new BadRequestException('Text extraction requires a buffer');
    return { text: ctx.buffer.toString('utf-8').trim() };
  }
}

/**
 * CSV extractor. Returns the header + a "natural language" rendering of each row
 * for better RAG retrieval (e.g. "Name: John. Email: [email protected].").
 */
@Injectable()
export class CsvExtractor implements Extractor {
  supports(ctx: ExtractorContext): boolean {
    return ctx.mimeType === 'text/csv' || /\.csv$/i.test(ctx.filename);
  }

  async extract(ctx: ExtractorContext): Promise<ExtractedDocument> {
    if (!ctx.buffer) throw new BadRequestException('CSV extraction requires a buffer');
    const raw = ctx.buffer.toString('utf-8');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { text: '' };

    const parse = (line: string): string[] => {
      const out: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = !inQuotes;
        } else if (c === ',' && !inQuotes) {
          out.push(cur); cur = '';
        } else {
          cur += c;
        }
      }
      out.push(cur);
      return out.map((s) => s.trim());
    };

    const headers = parse(lines[0]);
    const rows = lines.slice(1).map(parse);
    const blocks: string[] = [];
    blocks.push(`Headers: ${headers.join(', ')}`);
    for (const row of rows) {
      const pairs = headers.map((h, i) => `${h}: ${row[i] ?? ''}`).join('. ');
      blocks.push(`Row: ${pairs}.`);
    }
    return {
      text: blocks.join('\n'),
      metadata: { headers, rowCount: rows.length },
    };
  }
}

/**
 * HTML extractor (file or URL).
 */
@Injectable()
export class HtmlExtractor implements Extractor {
  supports(ctx: ExtractorContext): boolean {
    return ctx.mimeType === 'text/html' || /\.html?$/i.test(ctx.filename);
  }

  async extract(ctx: ExtractorContext): Promise<ExtractedDocument> {
    if (!ctx.buffer) throw new BadRequestException('HTML extraction requires a buffer');
    const html = ctx.buffer.toString('utf-8');
    return { text: this.toText(html), metadata: { format: 'html' } };
  }

  private toText(html: string): string {
    const $ = cheerio.load(html);
    $('script, style, noscript').remove();
    return $('body').text().replace(/\s+/g, ' ').trim();
  }
}

/**
 * URL extractor. Fetches the page and applies the HTML extractor.
 */
@Injectable()
export class UrlExtractor implements Extractor {
  private readonly logger = new Logger(UrlExtractor.name);

  supports(ctx: ExtractorContext): boolean {
    return !!ctx.url;
  }

  async extract(ctx: ExtractorContext): Promise<ExtractedDocument> {
    if (!ctx.url) throw new BadRequestException('URL extractor requires ctx.url');
    const res = await fetch(ctx.url, {
      headers: { 'User-Agent': 'AIBOS-KB/1.0 (+https://aibos.local/bot)' },
      redirect: 'follow',
    });
    if (!res.ok) {
      throw new BadRequestException(`Failed to fetch URL: ${res.status} ${res.statusText}`);
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    $('script, style, noscript').remove();
    const title = $('title').text().trim();
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    return {
      text: [title, text].filter(Boolean).join('\n\n'),
      metadata: { url: ctx.url, title, contentType: res.headers.get('content-type') },
    };
  }
}
