/**
 * Invitations module — email-based invitations to join an organization.
 *
 * Flow:
 *   1. Owner/Admin calls POST /organizations/:orgId/members/invite
 *   2. If the user exists, a row is added directly and an email is sent.
 *   3. If the user does NOT exist, an "invitation" row is created with a
 *      signed token; the email contains a link that lets the recipient
 *      create their account (or log in) and the membership is finalized.
 *   4. POST /invitations/accept consumes the token.
 *
 * Tokens: stored hashed in DB (sha256), sent raw in the email. 7-day TTL.
 */
import { ConflictException, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'node:crypto';
import { MemberRole } from '@prisma/client';

const INVITE_TTL_DAYS = 7;

export interface InvitationRecord {
  id: string;
  email: string;
  organizationId: string;
  role: MemberRole;
  expiresAt: Date;
  acceptedAt: Date | null;
  invitedBy: string;
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Create an invitation. If the user already exists, attach them directly.
   * Returns the raw token to be embedded in the email URL.
   */
  async invite(opts: {
    organizationId: string;
    email: string;
    role: MemberRole;
    invitedBy: string;
  }): Promise<{ token: string; expiresAt: Date; existing: boolean }> {
    const email = opts.email.toLowerCase();

    // Already a member?
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      const m = await this.prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: opts.organizationId, userId: existingUser.id } },
      });
      if (m) throw new ConflictException('User is already a member');

      await this.prisma.organizationMember.create({
        data: {
          organizationId: opts.organizationId,
          userId: existingUser.id,
          role: opts.role,
          invitedBy: opts.invitedBy,
        },
      });

      // Notify
      const org = await this.prisma.organization.findUnique({ where: { id: opts.organizationId } });
      if (org) {
        const url = `${this.config.get('FRONTEND_URL')}/organizations/${org.slug}`;
        await this.mail.send({
          to: email,
          subject: `Tu as été ajouté(e) à ${org.name}`,
          html: `<p>Tu fais maintenant partie de <strong>${org.name}</strong> sur AIBOS (rôle: ${opts.role}).</p><p><a href="${url}">Ouvrir l'espace</a></p>`,
        });
      }
      return { token: '', expiresAt: new Date(), existing: true };
    }

    // New user → create a pending invitation
    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000);

    // We re-use the same DB row "user" by creating it with a random password
    // they will reset on accept, OR we store the invite in a dedicated table.
    // We pick the dedicated table to keep the user model clean.
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO invitations (id, email, organization_id, role, token_hash, invited_by, expires_at)
       VALUES (gen_random_uuid(), $1, $2, $3::"MemberRole", $4, $5, $6)
       ON CONFLICT (email, organization_id) WHERE accepted_at IS NULL
       DO UPDATE SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at, role = EXCLUDED.role`,
      [email, opts.organizationId, opts.role, tokenHash, opts.invitedBy, expiresAt],
    );

    const org = await this.prisma.organization.findUnique({ where: { id: opts.organizationId } });
    const url = `${this.config.get('FRONTEND_URL')}/invitations/accept?token=${token}`;
    await this.mail.sendInvitation(email, org?.name ?? 'une organisation', url, opts.role);

    return { token, expiresAt, existing: false };
  }

  /**
   * Accept an invitation.
   *  - If the user already exists, log them in (caller decides).
   *  - If not, the caller must register a new user (the token binds the email).
   */
  async accept(token: string): Promise<{ email: string; organizationId: string; role: MemberRole }> {
    const hash = this.hashToken(token);
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT id, email, organization_id, role, expires_at, accepted_at
         FROM invitations
         WHERE token_hash = $1
         LIMIT 1`,
      [hash],
    );
    if (!rows.length) throw new NotFoundException('Invitation not found');
    const inv = rows[0];
    if (inv.accepted_at) throw new BadRequestException('Invitation already used');
    if (new Date(inv.expires_at) < new Date()) throw new BadRequestException('Invitation expired');

    return {
      email: inv.email,
      organizationId: inv.organization_id,
      role: inv.role,
    };
  }

  /**
   * Mark an invitation as accepted. Called by the auth/registration flow.
   * Also creates the membership.
   */
  async finalizeAccept(token: string, userId: string): Promise<{ organizationId: string; role: MemberRole }> {
    const inv = await this.accept(token);
    await this.prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: inv.organizationId, userId } },
      update: { role: inv.role },
      create: { organizationId: inv.organizationId, userId, role: inv.role },
    });
    await this.prisma.$executeRawUnsafe(
      `UPDATE invitations SET accepted_at = now() WHERE token_hash = $1`,
      [this.hashToken(token)],
    );
    return { organizationId: inv.organizationId, role: inv.role };
  }

  async listForOrg(orgId: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, email, role, expires_at, accepted_at, invited_by, created_at
         FROM invitations
         WHERE organization_id = $1
         ORDER BY created_at DESC`,
      [orgId],
    );
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

// We need an `invitations` table. For Phase 3 we keep things simple by
// using a raw SQL table (created by the same migration as the RLS init).
// A future Prisma-managed model can replace this.
