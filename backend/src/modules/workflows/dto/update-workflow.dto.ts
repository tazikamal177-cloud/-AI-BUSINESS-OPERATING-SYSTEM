import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateWorkflowDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum(['WEBHOOK', 'SCHEDULE', 'MANUAL', 'INCOMING_MESSAGE', 'NEW_LEAD', 'NEW_EMAIL', 'FORM_SUBMISSION'])
  trigger?: any;
  @IsOptional() @IsObject() triggerConfig?: Record<string, unknown>;
  @IsOptional() @IsObject() definition?: Record<string, any>;
  @IsOptional() @IsEnum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'])
  status?: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
}
