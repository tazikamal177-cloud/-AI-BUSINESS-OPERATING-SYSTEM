import { Global, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

export interface UploadResult {
  key: string;
  url: string;
  size: number;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private client!: S3Client;
  private bucket!: string;
  private publicBaseUrl: string | undefined;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const endpoint = this.config.get<string>('S3_ENDPOINT');
    const region = this.config.get<string>('S3_REGION') ?? 'us-east-1';
    const accessKey = this.config.get<string>('S3_ACCESS_KEY');
    const secretKey = this.config.get<string>('S3_SECRET_KEY');
    const forcePathStyle = this.config.get<boolean>('S3_FORCE_PATH_STYLE') ?? true;
    this.bucket = this.config.get<string>('S3_BUCKET') ?? 'aibos-uploads';

    this.client = new S3Client({
      region,
      endpoint,
      forcePathStyle,
      credentials:
        accessKey && secretKey ? { accessKeyId: accessKey, secretAccessKey: secretKey } : undefined,
    });
    this.publicBaseUrl = endpoint ? `${endpoint}/${this.bucket}` : undefined;

    // Ensure bucket exists (idempotent)
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch (e) {
        // Likely already exists or insufficient perms in prod — log and continue
        // eslint-disable-next-line no-console
        console.warn(`[storage] could not ensure bucket ${this.bucket}: ${(e as Error).message}`);
      }
    }
  }

  /**
   * Upload a buffer to the configured bucket under a tenant-scoped key.
   * Returns the object key (used in DB) and a public URL.
   */
  async upload(opts: {
    organizationId: string;
    buffer: Buffer;
    contentType: string;
    originalName: string;
    prefix?: string; // e.g. 'documents', 'avatars'
  }): Promise<UploadResult> {
    const ext = this.guessExt(opts.originalName, opts.contentType);
    const key = [
      opts.prefix ?? 'files',
      opts.organizationId,
      `${randomUUID()}${ext}`,
    ].join('/');

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: opts.buffer,
        ContentType: opts.contentType,
        Metadata: { 'original-name': opts.originalName.slice(0, 200) },
      }),
    );

    return {
      key,
      url: this.urlFor(key),
      size: opts.buffer.length,
    };
  }

  /**
   * Generate a presigned GET URL (default 5 min).
   */
  async presignGet(key: string, expiresInSeconds = 300): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, cmd, { expiresIn: expiresInSeconds });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  urlFor(key: string): string {
    return this.publicBaseUrl ? `${this.publicBaseUrl}/${key}` : `s3://${this.bucket}/${key}`;
  }

  private guessExt(name: string, mime: string): string {
    const dot = name.lastIndexOf('.');
    if (dot >= 0 && dot > name.length - 8) return name.slice(dot).toLowerCase();
    const map: Record<string, string> = {
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'text/csv': '.csv',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'image/png': '.png',
      'image/jpeg': '.jpg',
    };
    return map[mime] ?? '';
  }
}

@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
