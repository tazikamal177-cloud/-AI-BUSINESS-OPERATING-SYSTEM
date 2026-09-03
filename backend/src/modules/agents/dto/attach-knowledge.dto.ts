import { IsString } from 'class-validator';

export class AttachKnowledgeDto {
  @IsString()
  knowledgeBaseId: string;
}
