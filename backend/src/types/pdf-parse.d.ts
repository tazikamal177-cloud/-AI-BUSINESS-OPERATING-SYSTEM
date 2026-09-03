declare module 'pdf-parse' {
  import { Buffer } from 'node:buffer';
  interface PdfData {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    text: string;
    version: string;
  }
  interface PdfParseOptions {
    max?: number;
    version?: string;
  }
  const pdfParse: (data: Buffer | string, options?: PdfParseOptions) => Promise<PdfData>;
  export default pdfParse;
}
