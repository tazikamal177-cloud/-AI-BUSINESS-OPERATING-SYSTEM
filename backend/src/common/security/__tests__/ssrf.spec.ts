import { assertSafeUrl } from '../ssrf';

describe('SSRF guard', () => {
  const origAllowlist = process.env.HTTP_ALLOWED_HOSTS;
  const origEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (origAllowlist === undefined) delete process.env.HTTP_ALLOWED_HOSTS;
    else process.env.HTTP_ALLOWED_HOSTS = origAllowlist;
    if (origEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = origEnv;
  });

  it('blocks localhost', () => {
    process.env.NODE_ENV = 'development';
    expect(assertSafeUrl('http://localhost:3000/secret').ok).toBe(false);
  });

  it('blocks *.local and *.localhost', () => {
    process.env.NODE_ENV = 'development';
    expect(assertSafeUrl('http://api.local/').ok).toBe(false);
    expect(assertSafeUrl('http://x.localhost/').ok).toBe(false);
  });

  it('blocks private IPv4 ranges', () => {
    process.env.NODE_ENV = 'development';
    for (const ip of ['10.0.0.1', '127.0.0.1', '172.16.5.5', '192.168.1.1', '169.254.169.254', '0.0.0.0']) {
      expect(assertSafeUrl(`http://${ip}/`).ok).toBe(false);
    }
  });

  it('blocks cloud metadata hosts', () => {
    process.env.NODE_ENV = 'development';
    expect(assertSafeUrl('http://metadata.google.internal/computeMetadata/v1/').ok).toBe(false);
  });

  it('blocks non-HTTP(S) protocols', () => {
    process.env.NODE_ENV = 'development';
    expect(assertSafeUrl('file:///etc/passwd').ok).toBe(false);
    expect(assertSafeUrl('gopher://internal:1234/_').ok).toBe(false);
  });

  it('blocks HTTP in production', () => {
    process.env.NODE_ENV = 'production';
    expect(assertSafeUrl('http://example.com/').ok).toBe(false);
    expect(assertSafeUrl('https://example.com/').ok).toBe(true);
  });

  it('honors allowlist with wildcards', () => {
    process.env.NODE_ENV = 'development';
    process.env.HTTP_ALLOWED_HOSTS = 'api.example.com,*.trusted.io';
    expect(assertSafeUrl('https://api.example.com/v1').ok).toBe(true);
    expect(assertSafeUrl('https://a.trusted.io/v1').ok).toBe(true);
    expect(assertSafeUrl('https://b.trusted.io/v1').ok).toBe(true);
    expect(assertSafeUrl('https://attacker.com/').ok).toBe(false);
  });

  it('accepts public IPs and HTTPS hosts when no allowlist', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.HTTP_ALLOWED_HOSTS;
    expect(assertSafeUrl('https://example.com/path').ok).toBe(true);
    expect(assertSafeUrl('https://1.1.1.1/').ok).toBe(true);
  });

  it('rejects invalid URLs', () => {
    process.env.NODE_ENV = 'development';
    expect(assertSafeUrl('not a url').ok).toBe(false);
    expect(assertSafeUrl('').ok).toBe(false);
    expect(assertSafeUrl('a'.repeat(3000)).ok).toBe(false);
  });
});
