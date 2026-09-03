import {
  IsString,
  IsOptional,
  IsNumber,
  IsObject,
  Min,
  Max,
} from 'class-validator';

export class CreateAgentDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  objective?: string;

  @IsOptional()
  @IsString()
  systemInstructions?: string;

  @IsOptional()
  @IsString()
  personality?: string;

  @IsOptional()
  @IsString()
  tone?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  modelProvider?: string;

  @IsOptional()
  @IsString()
  modelName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsNumber()
  maxTokens?: number;

  @IsOptional()
  @IsObject()
  guardrails?: any;

  @IsOptional()
  @IsNumber()
  maxToolCalls?: number;

  @IsOptional()
  @IsNumber()
  timeoutSeconds?: number;
}
