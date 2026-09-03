import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { Connector, ConnectorContext, ConnectorResult } from './connector.types';

interface EmailCredentials {
  /** SMTP host (e.g. smtp.gmail.com, smtp.sendgrid.net). */
  host: string;
  port: string;
  user: string;
  pass: string;
  /** Optional display name for the From header. */
  fromName?: string;
  /** Override the From address. */
  fromAddress?: string;
  /** 'true' for TLS, 'false' for plain (rare). */
  secure?: string;
}

/**
 * Generic SMTP connector (works with Gmail app passwords, SendGrid, Mailgun,
 * Postmark, etc.). The credentials are intentionally decoupled from any
 * specific provider so an organization can plug in their own SMTP relay.
 */
@Injectable()
export class EmailConnector implements Connector {
  readonly id = 'email';
  readonly name = 'Email (SMTP)';
  private readonly logger = new Logger(EmailConnector.name);

  async ping(ctx: ConnectorContext): Promise<ConnectorResult> {
    const t = this.buildTransport(ctx.credentials as unknown as EmailCredentials);
    try {
      await t.verify();
      return { ok: true };
    } catch (e: any) {
      this.logger.warn(`SMTP verify failed: ${e?.message}`);
      return { ok: false, error: e?.message, code: 'smtp_verify_failed' };
    }
  }

  /**
   * Send a single email. Not invoked by the connector `ping()`; called from
   * the registered `send_email` tool in `tools.service.ts`.
   */
  async send(
    args: { to: string; subject: string; body: string; html?: string; cc?: string; bcc?: string },
    ctx: ConnectorContext,
  ): Promise<ConnectorResult<{ messageId: string }>> {
    const creds = ctx.credentials as unknown as EmailCredentials;
    if (!creds.host || !creds.port || !creds.user || !creds.pass) {
      return { ok: false, error: 'SMTP credentials missing', code: 'smtp_credentials_missing' };
    }
    const t = this.buildTransport(creds);
    const fromAddr = creds.fromAddress ?? creds.user;
    const from = creds.fromName ? `"${creds.fromName}" <${fromAddr}>` : fromAddr;
    try {
      const info = await t.sendMail({
        from,
        to: args.to,
        cc: args.cc,
        bcc: args.bcc,
        subject: args.subject,
        text: args.body,
        html: args.html,
      });
      return { ok: true, data: { messageId: info.messageId } };
    } catch (e: any) {
      return { ok: false, error: e?.message, code: 'smtp_send_failed' };
    }
  }

  private buildTransport(creds: EmailCredentials) {
    return nodemailer.createTransport({
      host: creds.host,
      port: parseInt(creds.port, 10) || 587,
      secure: creds.secure === 'true',
      auth: { user: creds.user, pass: creds.pass },
    });
  }
}
