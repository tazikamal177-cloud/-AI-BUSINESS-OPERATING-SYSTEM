import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: this.config.get<number>('SMTP_PORT') ?? 587,
        secure: (this.config.get<number>('SMTP_PORT') ?? 587) === 465,
        auth:
          this.config.get<string>('SMTP_USER') && this.config.get<string>('SMTP_PASSWORD')
            ? {
                user: this.config.get<string>('SMTP_USER')!,
                pass: this.config.get<string>('SMTP_PASSWORD')!,
              }
            : undefined,
      });
      this.logger.log(`SMTP configured: ${host}:${this.config.get('SMTP_PORT')}`);
    } else {
      this.logger.warn('SMTP not configured — emails will be logged to console only');
    }
  }

  async send(opts: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<void> {
    const from = this.config.get<string>('SMTP_FROM') ?? '[email protected]';

    if (!this.transporter) {
      // Dev fallback: log to console
      this.logger.log(
        `[DEV MAIL] to=${opts.to} subject="${opts.subject}"\n${opts.text ?? opts.html}`,
      );
      return;
    }

    try {
      await this.transporter.sendMail({
        from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      });
    } catch (e) {
      this.logger.error(`Failed to send mail to ${opts.to}: ${(e as Error).message}`);
      throw e;
    }
  }

  // ───── Templates ─────

  async sendEmailVerification(to: string, verifyUrl: string, firstName?: string) {
    return this.send({
      to,
      subject: 'Vérifie ton adresse email — AIBOS',
      html: `
        <div style="font-family:system-ui;max-width:560px;margin:auto;padding:24px">
          <h2>Bienvenue ${firstName ? `, ${firstName}` : ''} !</h2>
          <p>Confirme ton adresse email pour activer ton compte AIBOS :</p>
          <p><a href="${verifyUrl}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">Vérifier mon email</a></p>
          <p style="color:#666;font-size:13px">Ce lien expire dans 24h. Si tu n'es pas à l'origine de cette inscription, ignore ce message.</p>
        </div>
      `,
      text: `Bienvenue ! Confirme ton email : ${verifyUrl}`,
    });
  }

  async sendPasswordReset(to: string, resetUrl: string) {
    return this.send({
      to,
      subject: 'Réinitialise ton mot de passe — AIBOS',
      html: `
        <div style="font-family:system-ui;max-width:560px;margin:auto;padding:24px">
          <h2>Mot de passe oublié ?</h2>
          <p>Clique ci-dessous pour définir un nouveau mot de passe :</p>
          <p><a href="${resetUrl}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">Réinitialiser</a></p>
          <p style="color:#666;font-size:13px">Ce lien expire dans 1h. Si tu n'es pas à l'origine de cette demande, ignore ce message.</p>
        </div>
      `,
      text: `Réinitialise ton mot de passe : ${resetUrl}`,
    });
  }

  async sendInvitation(to: string, orgName: string, inviteUrl: string, role: string) {
    return this.send({
      to,
      subject: `Invitation à rejoindre ${orgName} sur AIBOS`,
      html: `
        <div style="font-family:system-ui;max-width:560px;margin:auto;padding:24px">
          <h2>Tu es invité(e) !</h2>
          <p>On t'invite à rejoindre <strong>${orgName}</strong> en tant que <strong>${role}</strong>.</p>
          <p><a href="${inviteUrl}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">Accepter l'invitation</a></p>
          <p style="color:#666;font-size:13px">Ce lien expire dans 7 jours.</p>
        </div>
      `,
      text: `Accepte l'invitation à rejoindre ${orgName} : ${inviteUrl}`,
    });
  }
}
