import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { MailService } from '../mail/mail.service';
import { RegisterDto, ForgotPasswordDto, ResetPasswordDto, ChangePasswordDto } from './dto/register.dto';
import { AuditService } from '../audit/audit.service';

const PWD_RESET_TTL_SEC = 60 * 60;       // 1h
const EMAIL_VERIFY_TTL_SEC = 24 * 60 * 60; // 24h

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  // ──────────────────────────── Register ────────────────────────────

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
      },
    });

    // Default organization
    const orgName = dto.organizationName?.trim() || `${dto.firstName}'s Organization`;
    const slug = await this.generateUniqueSlug(orgName);
    const organization = await this.prisma.organization.create({
      data: { name: orgName, slug },
    });
    await this.prisma.organizationMember.create({
      data: { organizationId: organization.id, userId: user.id, role: 'OWNER' },
    });

    // Free subscription
    const freePlan = await this.prisma.plan.findUnique({ where: { slug: 'free' } });
    if (freePlan) {
      const end = new Date();
      end.setMonth(end.getMonth() + 1);
      await this.prisma.subscription.create({
        data: {
          organizationId: organization.id,
          planId: freePlan.id,
          currentPeriodStart: new Date(),
          currentPeriodEnd: end,
        },
      });
    }

    // Send email verification
    await this.sendEmailVerification(user.id, user.email, user.firstName);

    const tokens = await this.generateTokens(user.id, organization.id);
    return {
      user: this.sanitizeUser(user),
      organization: { id: organization.id, name: organization.name, slug: organization.slug },
      ...tokens,
    };
  }

  // ──────────────────────────── Login ────────────────────────────

  async login(dto: { email: string; password: string }) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('Account is not active');

    const membership = await this.prisma.organizationMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new UnauthorizedException('No organization found');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.generateTokens(user.id, membership.organizationId);
    return {
      user: this.sanitizeUser(user),
      organization: { id: membership.organizationId, role: membership.role },
      ...tokens,
    };
  }

  // ──────────────────────────── Refresh / Logout ────────────────────────────

  async refreshToken(refreshToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const membership = await this.prisma.organizationMember.findFirst({
      where: { userId: stored.userId },
      orderBy: { createdAt: 'asc' },
    });

    // Rotate
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.generateTokens(stored.userId, membership?.organizationId);
  }

  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { token: refreshToken, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } else {
      // Logout from all sessions
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { message: 'Logged out successfully' };
  }

  // ──────────────────────────── Forgot / Reset password ────────────────────────────

  async forgotPassword(dto: ForgotPasswordDto) {
    // Always return success to prevent email enumeration
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!user) return { message: 'If the email exists, a reset link has been sent' };

    const token = randomBytes(32).toString('hex');
    await this.redis.set(`pwd-reset:${token}`, user.id, PWD_RESET_TTL_SEC);

    const url = `${this.config.get('FRONTEND_URL')}/reset-password?token=${token}`;
    await this.mail.sendPasswordReset(user.email, url);

    return { message: 'If the email exists, a reset link has been sent' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const userId = await this.redis.get(`pwd-reset:${dto.token}`);
    if (!userId) throw new BadRequestException('Invalid or expired token');

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.redis.del(`pwd-reset:${dto.token}`);

    // Invalidate all refresh tokens
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { message: 'Password updated' };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    return { message: 'Password changed' };
  }

  // ──────────────────────────── Email verification ────────────────────────────

  private async sendEmailVerification(userId: string, email: string, firstName?: string) {
    const token = randomBytes(32).toString('hex');
    await this.redis.set(`email-verify:${token}`, userId, EMAIL_VERIFY_TTL_SEC);
    const url = `${this.config.get('FRONTEND_URL')}/verify-email?token=${token}`;
    await this.mail.sendEmailVerification(email, url, firstName);
  }

  async verifyEmail(token: string) {
    const userId = await this.redis.get(`email-verify:${token}`);
    if (!userId) throw new BadRequestException('Invalid or expired token');

    await this.prisma.user.update({
      where: { id: userId },
      data: { isEmailVerified: true, emailVerifiedAt: new Date() },
    });
    await this.redis.del(`email-verify:${token}`);

    return { message: 'Email verified' };
  }

  async resendVerification(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.isEmailVerified) throw new BadRequestException('Email already verified');
    await this.sendEmailVerification(user.id, user.email, user.firstName);
    return { message: 'Verification email sent' };
  }

  // ──────────────────────────── Switch active org ────────────────────────────

  /**
   * Returns a NEW access token (and rotated refresh) for the chosen org.
   * The user must be a member of the target org.
   */
  async switchOrganization(userId: string, targetOrgId: string) {
    const membership = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: targetOrgId, userId } },
    });
    if (!membership) throw new ForbiddenException('Not a member of this organization');
    return this.generateTokens(userId, targetOrgId);
  }

  // ──────────────────────────── Profile ────────────────────────────

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        isEmailVerified: true,
        lastLoginAt: true,
        createdAt: true,
        memberships: {
          select: {
            organization: { select: { id: true, name: true, slug: true, logoUrl: true } },
            role: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // ──────────────────────────── Helpers ────────────────────────────

  private async generateTokens(userId: string, organizationId?: string) {
    const payload = { sub: userId, org: organizationId };
    const accessToken = this.jwtService.sign(payload);
    const refreshTokenValue = randomBytes(48).toString('hex');
    const refreshExpStr = this.config.get<string>('JWT_REFRESH_EXPIRATION') ?? '7d';
    const expiresAt = this.parseExpiry(refreshExpStr);

    await this.prisma.refreshToken.create({
      data: { userId, token: refreshTokenValue, expiresAt },
    });

    return { accessToken, refreshToken: refreshTokenValue };
  }

  private parseExpiry(s: string): Date {
    const m = /^(\d+)([smhd])$/.exec(s);
    if (!m) return new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const n = parseInt(m[1], 10);
    const unit = m[2];
    const ms: Record<string, number> = {
      s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000,
    };
    return new Date(Date.now() + n * (ms[unit] ?? ms.d));
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'org';
    let slug = base;
    let i = 1;
    while (await this.prisma.organization.findUnique({ where: { slug } })) {
      slug = `${base}-${i++}`;
      if (i > 100) slug = `${base}-${randomBytes(3).toString('hex')}`;
    }
    return slug;
  }

  private sanitizeUser(u: any) {
    return {
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      isEmailVerified: u.isEmailVerified,
      avatarUrl: u.avatarUrl,
    };
  }
}
