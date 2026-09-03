import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * CredentialsService — AES-256-GCM symmetric encryption for integration
 * credentials (OAuth tokens, API keys, webhook secrets, etc.).
 *
 * Key derivation:
 *   1. Take `SECRETS_ENCRYPTION_KEY` from env.
 *   2. SHA-256 it to obtain a stable 32-byte key.
 *
 * Storage format (base64, all three concatenated):
 *   [12-byte IV][16-byte authTag][ciphertext]
 *
 * On startup the service refuses to boot if no key is set in production
 * (`NODE_ENV=production`). In dev it falls back to a deterministic key
 * derived from `JWT_SECRET` (with a clear warning) so the seed can run.
 */
@Injectable()
export class CredentialsService implements OnModuleInit {
  private readonly logger = new Logger(CredentialsService.name);
  private key!: Buffer;
  private readonly ALGO = 'aes-256-gcm' as const;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const env = this.config.get<string>('NODE_ENV') ?? 'development';
    let raw = this.config.get<string>('SECRETS_ENCRYPTION_KEY');
    if (!raw) {
      if (env === 'production') {
        throw new Error(
          'SECRETS_ENCRYPTION_KEY is required in production. Generate one with `openssl rand -base64 32`.',
        );
      }
      raw = this.config.get<string>('JWT_SECRET') ?? 'dev-only-key';
      this.logger.warn(
        'SECRETS_ENCRYPTION_KEY not set — falling back to a derived dev key. Set it in production.',
      );
    }
    // 32-byte key, derived via SHA-256 (deterministic but length-correct).
    this.key = scryptSync(raw, 'aibos-salt-v1', 32);
  }

  /**
   * Encrypt a plaintext secret. Returns a single base64 string ready to be
   * stored in `integration_credentials.encrypted_value`.
   */
  encrypt(plaintext: string): string {
    if (typeof plaintext !== 'string') {
      throw new TypeError('encrypt() expects a string');
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv(this.ALGO, this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]).toString('base64');
  }

  /**
   * Decrypt a previously-encrypted payload. Throws on tampering (auth tag
   * mismatch) or malformed input.
   */
  decrypt(payload: string): string {
    if (typeof payload !== 'string' || !payload) {
      throw new TypeError('decrypt() expects a non-empty base64 string');
    }
    const buf = Buffer.from(payload, 'base64');
    if (buf.length < 12 + 16 + 1) {
      throw new Error('Encrypted payload too short');
    }
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = createDecipheriv(this.ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf-8');
  }
}
