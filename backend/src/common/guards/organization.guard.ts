import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OrganizationGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.sub) {
      throw new ForbiddenException('User not authenticated');
    }

    // Get organization ID from header or user token
    const orgId =
      request.headers['x-organization-id'] || request.user?.org;

    if (!orgId) {
      throw new ForbiddenException('Organization not specified');
    }

    // Verify user belongs to organization
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId: user.sub,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('Not a member of this organization');
    }

    // Attach organization and role to request
    request.organizationId = orgId;
    request.userRole = membership.role;
    request.membership = membership;

    return true;
  }
}
