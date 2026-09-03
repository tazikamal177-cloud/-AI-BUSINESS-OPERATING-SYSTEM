import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../common/guards/organization.guard';

@Controller('billing')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('subscription')
  async getSubscription(@Req() req: any) {
    return this.billingService.getSubscription(req.organizationId);
  }

  @Get('plans')
  async getPlans() {
    return this.billingService.getPlans();
  }

  @Get('usage')
  async getUsage(@Req() req: any) {
    return this.billingService.getUsage(req.organizationId);
  }
}
