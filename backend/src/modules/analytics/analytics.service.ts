import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(orgId: string) {
    const [
      totalAgents,
      activeAgents,
      totalConversations,
      totalTasks,
      completedTasks,
      totalUsage,
    ] = await Promise.all([
      this.prisma.agent.count({ where: { organizationId: orgId } }),
      this.prisma.agent.count({ where: { organizationId: orgId, status: 'ACTIVE' } }),
      this.prisma.conversation.count({ where: { organizationId: orgId } }),
      this.prisma.task.count({ where: { organizationId: orgId } }),
      this.prisma.task.count({ where: { organizationId: orgId, status: 'COMPLETED' } }),
      this.prisma.usageRecord.aggregate({
        where: { organizationId: orgId },
        _sum: {
          totalTokens: true,
          estimatedCost: true,
        },
      }),
    ]);

    return {
      totalAgents,
      activeAgents,
      totalConversations,
      totalTasks,
      completedTasks,
      totalTokens: totalUsage._sum.totalTokens || 0,
      totalCost: totalUsage._sum.estimatedCost || 0,
    };
  }

  async getAgentPerformance(orgId: string) {
    const agents = await this.prisma.agent.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        name: true,
        status: true,
        _count: {
          select: {
            conversations: true,
          },
        },
      },
    });

    return agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      conversations: agent._count?.conversations ?? 0,
      tasks: 0,
    }));
  }

  async getUsageHistory(orgId: string, days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const usage = await this.prisma.usageRecord.findMany({
      where: {
        organizationId: orgId,
        createdAt: { gte: startDate },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Group by date
    const grouped: Record<string, { tokens: number; cost: number; count: number }> = {};

    for (const record of usage) {
      const date = record.createdAt.toISOString().split('T')[0];
      if (!grouped[date]) {
        grouped[date] = { tokens: 0, cost: 0, count: 0 };
      }
      grouped[date].tokens += record.totalTokens;
      grouped[date].cost += Number(record.estimatedCost);
      grouped[date].count += 1;
    }

    return Object.entries(grouped).map(([date, data]) => ({
      date,
      ...data,
    }));
  }

  async getRecentActivity(orgId: string, limit: number = 20) {
    const [conversations, tasks, agents] = await Promise.all([
      this.prisma.conversation.findMany({
        where: { organizationId: orgId },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        include: {
          agent: { select: { name: true } },
          user: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.task.findMany({
        where: { organizationId: orgId },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      }),
      this.prisma.agent.findMany({
        where: { organizationId: orgId },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      }),
    ]);

    return {
      conversations,
      tasks,
      agents,
    };
  }
}
