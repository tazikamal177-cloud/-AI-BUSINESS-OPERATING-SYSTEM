import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class SearchKnowledgeDto {
  @IsString()
  query!: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : parseInt(value, 10)))
  @IsInt()
  @Min(1)
  @Max(50)
  topK?: number;
}
