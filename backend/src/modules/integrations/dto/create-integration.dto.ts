import { IsEnum, IsObject, IsOptional, IsString, Length, MinLength } from 'class-validator';

export class CreateIntegrationDto {
  @IsString()
  @MinLength(1)
  provider!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(['COMMUNICATION', 'CRM', 'COMMERCE', 'PRODUCTIVITY', 'CUSTOM'])
  type!: 'COMMUNICATION' | 'CRM' | 'COMMERCE' | 'PRODUCTIVITY' | 'CUSTOM';

  /** Free-form config: from-name, base URL, project ID, etc. */
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;

  /**
   * Decrypted-by-the-client credentials.
   * Will be AES-256-GCM encrypted server-side before persistence.
   * Example: { "host": "smtp.gmail.com", "port": "587", "user": "…", "pass": "…" }
   */
  @IsObject()
  credentials!: Record<string, string>;
}
