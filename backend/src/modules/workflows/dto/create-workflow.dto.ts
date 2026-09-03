import { IsEnum, IsObject, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class WorkflowNodeDto {
  @IsString() id!: string;
  @IsEnum(['TRIGGER', 'CONDITION', 'AGENT', 'ACTION', 'WAIT', 'PARALLEL', 'END']) type!: any;
  @IsString() name!: string;
  @IsOptional() @IsString() agentId?: string;
  @IsOptional() positionX?: number;
  @IsOptional() positionY?: number;
  @IsOptional() @IsObject() configuration?: Record<string, unknown>;
}

export class WorkflowEdgeDto {
  @IsString() id!: string;
  @IsString() sourceNodeId!: string;
  @IsString() targetNodeId!: string;
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsObject() condition?: Record<string, unknown>;
}

export class CreateWorkflowDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsEnum(['WEBHOOK', 'SCHEDULE', 'MANUAL', 'INCOMING_MESSAGE', 'NEW_LEAD', 'NEW_EMAIL', 'FORM_SUBMISSION'])
  trigger!: any;
  @IsObject() triggerConfig!: Record<string, unknown>;
  /** Canonical graph (nodes + edges). */
  @IsOptional() @IsObject() definition?: Record<string, any>;
  /** Convenience: pass nodes/edges inline and we'll wrap them. */
  @IsOptional() @IsObject() nodes?: any[];
  @IsOptional() @IsObject() edges?: any[];
}
