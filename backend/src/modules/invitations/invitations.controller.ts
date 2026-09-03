import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IsEmail, IsIn, IsString } from 'class-validator';
import { MemberRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';

class InviteDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsIn(['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'])
  role: MemberRole;
}

class AcceptInviteDto {
  @IsString()
  token: string;

  // Optional, only used if the user doesn't exist yet
  @IsString()
  firstName?: string;

  @IsString()
  lastName?: string;

  @IsString()
  password?: string;
}

@Controller()
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post('organizations/:orgId/members/invite')
  @UseGuards(JwtAuthGuard, OrganizationGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async invite(
    @Param('orgId') orgId: string,
    @CurrentUser('sub') invitedBy: string,
    @Body() dto: InviteDto,
  ) {
    return this.invitations.invite({
      organizationId: orgId,
      email: dto.email,
      role: dto.role,
      invitedBy,
    });
  }

  @Get('organizations/:orgId/invitations')
  @UseGuards(JwtAuthGuard, OrganizationGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async list(@Param('orgId') orgId: string) {
    return this.invitations.listForOrg(orgId);
  }

  @Post('invitations/accept')
  async accept(@Body() dto: AcceptInviteDto) {
    const inv = await this.invitations.accept(dto.token);
    return inv;
  }
}
