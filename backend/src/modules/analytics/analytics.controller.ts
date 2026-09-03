import { Controller, Get, UseGuards, Req, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';

@Controller('analytics')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  async getOverview(@Req() req: any) {
    return this.analyticsService.getOverview(req.organizationId);
  }

  @Get('agents')
  async getAgentPerformance(@Req() req: any) {
    return this.analyticsService.getAgentPerformance(req.organizationId);
  }

  @Get('usage')
  async getUsageHistory(@Query('days') days: string, @Req() req: any) {
    return this.analyticsService.getUsageHistory(req.organizationId, days ? parseInt(days) : 30);
  }

  @Get('activity')
  async getRecentActivity(@Req() req: any) {
    return this.analyticsService.getRecentActivity(req.organizationId);
  }
}
