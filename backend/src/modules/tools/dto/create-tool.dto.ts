import { IsString, IsOptional, IsObject, IsEnum } from 'class-validator';

export class CreateToolDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsString()
  description: string;

  @IsObject()
  inputSchema: any;

  @IsOptional()
  @IsObject()
  outputSchema?: any;

  @IsOptional()
  @IsObject()
  configuration?: any;

  @IsOptional()
  @IsObject()
  permissions?: any;

  @IsOptional()
  @IsEnum(['LOW', 'MEDIUM', 'HIGH'])
  riskLevel?: string;
}
