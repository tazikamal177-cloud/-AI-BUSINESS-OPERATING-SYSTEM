import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';

export class CreateKnowledgeBaseDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  embeddingModel?: string;

  @IsOptional()
  @IsString()
  chunkSize?: number;

  @IsOptional()
  @IsString()
  chunkOverlap?: number;
}
