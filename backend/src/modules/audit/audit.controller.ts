import { Controller, Get, UseGuards, Req, Query } from '@nestjs/common';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';

@Controller('audit-logs')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async findAll(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('userId') userId?: string,
    @Query('since') since?: string,
  ) {
    return this.auditService.search({
      organizationId: req.organizationId,
      limit: limit ? Math.min(parseInt(limit), 500) : 100,
      offset: offset ? parseInt(offset) : 0,
      action,
      resourceType,
      userId,
      since: since ? new Date(since) : undefined,
    });
  }

  @Get('recent')
  async recent(@Req() req: any, @Query('limit') limit?: string) {
    return this.auditService.findAll(
      req.organizationId,
      limit ? Math.min(parseInt(limit), 50) : 20,
      0,
    );
  }
}
