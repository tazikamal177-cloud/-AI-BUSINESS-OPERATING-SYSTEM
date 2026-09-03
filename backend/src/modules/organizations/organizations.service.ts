import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { InviteMemberDto } from './dto/invite-member.dto';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId },
      include: {
        organization: {
          include: {
            _count: {
              select: { members: true, agents: true },
            },
          },
        },
      },
    });

    return memberships.map((m) => ({
      role: m.role,
      joinedAt: m.joinedAt,
      organization: {
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        logoUrl: m.organization.logoUrl,
        industry: m.organization.industry,
        status: m.organization.status,
        memberCount: m.organization._count.members,
        agentCount: m.organization._count.agents,
        createdAt: m.organization.createdAt,
      },
    }));
  }

  async findOne(orgId: string, userId: string) {
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId,
        },
      },
      include: {
        organization: {
          include: {
            _count: {
              select: { members: true, agents: true },
            },
          },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('Organization not found');
    }

    return {
      role: membership.role,
      organization: membership.organization,
    };
  }

  async create(dto: CreateOrganizationDto, userId: string) {
    const slug = await this.generateUniqueSlug(dto.name);

    const organization = await this.prisma.organization.create({
      data: {
        id: uuidv4(),
        name: dto.name,
        slug,
        industry: dto.industry,
        country: dto.country,
        language: dto.language,
        timezone: dto.timezone,
      },
    });

    // Add creator as owner
    await this.prisma.organizationMember.create({
      data: {
        id: uuidv4(),
        organizationId: organization.id,
        userId,
        role: 'OWNER',
      },
    });

    return organization;
  }

  async update(
    orgId: string,
    dto: UpdateOrganizationDto,
    userId: string,
  ) {
    await this.verifyAdminAccess(orgId, userId);

    return this.prisma.organization.update({
      where: { id: orgId },
      data: {
        name: dto.name,
        logoUrl: dto.logoUrl,
        industry: dto.industry,
        country: dto.country,
        language: dto.language,
        timezone: dto.timezone,
        settings: dto.settings,
      },
    });
  }

  async getMembers(orgId: string, userId: string) {
    await this.verifyMembership(orgId, userId);

    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId: orgId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            lastLoginAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return members.map((m) => ({
      id: m.id,
      role: m.role,
      joinedAt: m.joinedAt,
      user: m.user,
    }));
  }

  async inviteMember(
    orgId: string,
    dto: InviteMemberDto,
    invitedBy: string,
  ) {
    await this.verifyAdminAccess(orgId, invitedBy);

    // Check if user exists
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      // In production, send invitation email
      throw new NotFoundException('User not found. Invitation email will be sent.');
    }

    // Check if already a member
    const existing = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId: user.id,
        },
      },
    });

    if (existing) {
      throw new ConflictException('User is already a member');
    }

    const member = await this.prisma.organizationMember.create({
      data: {
        id: uuidv4(),
        organizationId: orgId,
        userId: user.id,
        role: (dto.role || 'OPERATOR') as any,
        invitedBy,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    return member;
  }

  async updateMemberRole(
    orgId: string,
    memberUserId: string,
    role: string,
    currentUserId: string,
  ) {
    await this.verifyOwnerAccess(orgId, currentUserId);

    if (memberUserId === currentUserId) {
      throw new ForbiddenException('Cannot change your own role');
    }

    return this.prisma.organizationMember.update({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId: memberUserId,
        },
      },
      data: { role: role as any },
    });
  }

  async removeMember(
    orgId: string,
    memberUserId: string,
    currentUserId: string,
  ) {
    await this.verifyAdminAccess(orgId, currentUserId);

    if (memberUserId === currentUserId) {
      throw new ForbiddenException('Cannot remove yourself');
    }

    const member = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId: memberUserId,
        },
      },
    });

    if (member?.role === 'OWNER') {
      throw new ForbiddenException('Cannot remove the owner');
    }

    await this.prisma.organizationMember.delete({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId: memberUserId,
        },
      },
    });

    return { message: 'Member removed successfully' };
  }

  private async verifyMembership(orgId: string, userId: string) {
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('Not a member of this organization');
    }

    return membership;
  }

  private async verifyAdminAccess(orgId: string, userId: string) {
    const membership = await this.verifyMembership(orgId, userId);

    if (!['OWNER', 'ADMIN'].includes(membership.role)) {
      throw new ForbiddenException('Admin access required');
    }

    return membership;
  }

  private async verifyOwnerAccess(orgId: string, userId: string) {
    const membership = await this.verifyMembership(orgId, userId);

    if (membership.role !== 'OWNER') {
      throw new ForbiddenException('Owner access required');
    }

    return membership;
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    let slug = base;
    let counter = 1;

    while (await this.prisma.organization.findUnique({ where: { slug } })) {
      slug = `${base}-${counter}`;
      counter++;
    }

    return slug;
  }
}
