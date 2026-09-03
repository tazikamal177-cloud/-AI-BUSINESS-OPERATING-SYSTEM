import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(data: {
    organizationId: string;
    userId?: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    metadata?: any;
    ipAddress?: string;
    userAgent?: string;
    result?: string;
  }) {
    return this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        organizationId: data.organizationId,
        userId: data.userId,
        action: data.action,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        metadata: data.metadata,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        result: data.result || 'SUCCESS',
      },
    });
  }

  async findAll(orgId: string, limit: number = 100, offset: number = 0) {
    return this.prisma.auditLog.findMany({
      where: { organizationId: orgId },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async search(opts: {
    organizationId: string;
    limit?: number;
    offset?: number;
    action?: string;
    resourceType?: string;
    userId?: string;
    since?: Date;
  }) {
    return this.prisma.auditLog.findMany({
      where: {
        organizationId: opts.organizationId,
        ...(opts.action ? { action: { contains: opts.action } } : {}),
        ...(opts.resourceType ? { resourceType: opts.resourceType } : {}),
        ...(opts.userId ? { userId: opts.userId } : {}),
        ...(opts.since ? { createdAt: { gte: opts.since } } : {}),
      },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: opts.limit ?? 100,
      skip: opts.offset ?? 0,
    });
  }

  async findByUser(orgId: string, userId: string) {
    return this.prisma.auditLog.findMany({
      where: { organizationId: orgId, userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async findByResource(orgId: string, resourceType: string, resourceId: string) {
    return this.prisma.auditLog.findMany({
      where: {
        organizationId: orgId,
        resourceType,
        resourceId,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
