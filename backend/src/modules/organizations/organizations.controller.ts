import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  async findAll(@CurrentUser('sub') userId: string) {
    return this.organizationsService.findAll(userId);
  }

  @Get(':orgId')
  @UseGuards(OrganizationGuard)
  async findOne(
    @Param('orgId') orgId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.organizationsService.findOne(orgId, userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateOrganizationDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.organizationsService.create(dto, userId);
  }

  @Put(':orgId')
  @UseGuards(OrganizationGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async update(
    @Param('orgId') orgId: string,
    @Body() dto: UpdateOrganizationDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.organizationsService.update(orgId, dto, userId);
  }

  @Get(':orgId/members')
  @UseGuards(OrganizationGuard)
  async getMembers(
    @Param('orgId') orgId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.organizationsService.getMembers(orgId, userId);
  }

  @Post(':orgId/members/invite')
  @UseGuards(OrganizationGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.CREATED)
  async inviteMember(
    @Param('orgId') orgId: string,
    @Body() dto: InviteMemberDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.organizationsService.inviteMember(orgId, dto, userId);
  }

  @Put(':orgId/members/:userId')
  @UseGuards(OrganizationGuard, RolesGuard)
  @Roles('OWNER')
  async updateMemberRole(
    @Param('orgId') orgId: string,
    @Param('userId') memberUserId: string,
    @Body() dto: UpdateMemberRoleDto,
    @CurrentUser('sub') currentUserId: string,
  ) {
    return this.organizationsService.updateMemberRole(
      orgId,
      memberUserId,
      dto.role,
      currentUserId,
    );
  }

  @Delete(':orgId/members/:userId')
  @UseGuards(OrganizationGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  async removeMember(
    @Param('orgId') orgId: string,
    @Param('userId') memberUserId: string,
    @CurrentUser('sub') currentUserId: string,
  ) {
    return this.organizationsService.removeMember(
      orgId,
      memberUserId,
      currentUserId,
    );
  }
}
