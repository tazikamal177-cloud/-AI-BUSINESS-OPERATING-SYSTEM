import { CsvExtractor, HtmlExtractor, TextExtractor } from '../extractors/extractors';

describe('CSV Extractor', () => {
  const ex = new CsvExtractor();
  it('rejects non-CSV', () => {
    expect(ex.supports({ filename: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('') })).toBe(false);
    expect(ex.supports({ filename: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from('') })).toBe(true);
  });

  it('renders rows as natural language for RAG', async () => {
    const csv = 'name,email,city\nAlice,[email protected],Paris\nBob,[email protected],Lyon\n';
    const { text, metadata } = await ex.extract({ filename: 'users.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    expect(text).toContain('Headers: name, email, city');
    expect(text).toContain('name: Alice');
    expect(text).toContain('email: [email protected]');
    expect(text).toContain('city: Paris');
    expect(text).toContain('name: Bob');
    expect((metadata as any).rowCount).toBe(2);
  });

  it('handles quoted fields with commas', async () => {
    const csv = 'title,desc\n"Hello, World","Quoted ""value"""\n';
    const { text } = await ex.extract({ filename: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    expect(text).toContain('title: Hello, World');
    expect(text).toContain('desc: Quoted "value"');
  });
});

describe('Text Extractor', () => {
  const ex = new TextExtractor();
  it('accepts .md and .json', () => {
    expect(ex.supports({ filename: 'readme.md', mimeType: '', buffer: Buffer.from('') })).toBe(true);
    expect(ex.supports({ filename: 'package.json', mimeType: '', buffer: Buffer.from('') })).toBe(true);
    expect(ex.supports({ filename: 'script.py', mimeType: '', buffer: Buffer.from('') })).toBe(true);
  });
  it('reads utf-8 text', async () => {
    const { text } = await ex.extract({ filename: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('héllo wörld', 'utf-8') });
    expect(text).toBe('héllo wörld');
  });
});

describe('HTML Extractor', () => {
  const ex = new HtmlExtractor();
  it('strips script/style tags', async () => {
    const html = '<html><head><style>body{color:red}</style><script>alert(1)</script></head><body><h1>Title</h1><p>Hello world</p></body></html>';
    const { text } = await ex.extract({ filename: 'a.html', mimeType: 'text/html', buffer: Buffer.from(html) });
    expect(text).toContain('Title');
    expect(text).toContain('Hello world');
    expect(text).not.toContain('alert(1)');
    expect(text).not.toContain('color:red');
  });
});
