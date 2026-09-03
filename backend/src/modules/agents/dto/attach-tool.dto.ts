import { IsString, IsOptional, IsObject } from 'class-validator';

export class AttachToolDto {
  @IsString()
  toolId: string;

  @IsOptional()
  @IsObject()
  configuration?: any;
}
