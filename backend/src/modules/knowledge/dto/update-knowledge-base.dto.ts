import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateKnowledgeBaseDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(64)
  @Max(4000)
  chunkSize?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2000)
  chunkOverlap?: number;
}
