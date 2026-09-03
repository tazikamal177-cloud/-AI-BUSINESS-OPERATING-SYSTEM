import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  async getSubscription(orgId: string) {
    return this.prisma.subscription.findUnique({
      where: { organizationId: orgId },
      include: { plan: true },
    });
  }

  async getPlans() {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { priceMonthly: 'asc' },
    });
  }

  async getUsage(orgId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const usage = await this.prisma.usageRecord.aggregate({
      where: {
        organizationId: orgId,
        createdAt: { gte: startOfMonth },
      },
      _sum: {
        totalTokens: true,
        estimatedCost: true,
      },
      _count: true,
    });

    return {
      period: startOfMonth.toISOString(),
      totalTokens: usage._sum.totalTokens || 0,
      totalCost: usage._sum.estimatedCost || 0,
      totalRequests: usage._count,
    };
  }
}
