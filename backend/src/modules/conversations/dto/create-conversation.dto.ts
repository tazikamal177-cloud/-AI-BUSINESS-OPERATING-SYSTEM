import { IsString, IsOptional } from 'class-validator';

export class CreateConversationDto {
  @IsString()
  agentId: string;

  @IsOptional()
  @IsString()
  title?: string;
}
