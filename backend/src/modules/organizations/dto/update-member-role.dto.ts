import { IsString } from 'class-validator';

export class UpdateMemberRoleDto {
  @IsString()
  role: string;
}
