import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  IsObject,
} from 'class-validator';

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'REQUIRES_APPROVAL'])
  status?: string;

  @IsOptional()
  @IsEnum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsObject()
  result?: any;
}
