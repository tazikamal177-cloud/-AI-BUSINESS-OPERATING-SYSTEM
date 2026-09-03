import { CredentialsService } from '../credentials.service';
import { ConfigService } from '@nestjs/config';

describe('CredentialsService', () => {
  let svc: CredentialsService;

  beforeEach(() => {
    const config = {
      get: (k: string) => (k === 'NODE_ENV' ? 'development' : 'test-key-12345'),
    } as unknown as ConfigService;
    svc = new CredentialsService(config);
    (svc as any).onModuleInit();
  });

  it('roundtrips a simple secret', () => {
    const ct = svc.encrypt('hello-world');
    expect(ct).not.toContain('hello-world');
    expect(svc.decrypt(ct)).toBe('hello-world');
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const a = svc.encrypt('same');
    const b = svc.encrypt('same');
    expect(a).not.toBe(b);
    expect(svc.decrypt(a)).toBe('same');
    expect(svc.decrypt(b)).toBe('same');
  });

  it('handles unicode and long payloads', () => {
    const long = '🎉 café résumé — '.repeat(500);
    const ct = svc.encrypt(long);
    expect(svc.decrypt(ct)).toBe(long);
  });

  it('throws on tampered ciphertext (auth tag mismatch)', () => {
    const ct = svc.encrypt('secret');
    const buf = Buffer.from(ct, 'base64');
    // Flip a byte in the ciphertext (after IV + tag)
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString('base64');
    expect(() => svc.decrypt(tampered)).toThrow();
  });

  it('throws on too-short input', () => {
    expect(() => svc.decrypt(Buffer.alloc(10).toString('base64'))).toThrow();
  });

  it('throws on invalid type', () => {
    expect(() => svc.encrypt(123 as any)).toThrow(TypeError);
    expect(() => svc.decrypt('')).toThrow(TypeError);
  });
});
