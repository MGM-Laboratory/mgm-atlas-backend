import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

interface SendOptions {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

/**
 * System-internal mailer (Mailtrap SMTP). Only used for fallback / admin-only
 * notifications. User-facing email is orchestrated by n8n via WebhooksService.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const host = config.get<string>('mail.host');
    const port = config.get<number>('mail.port');
    const user = config.get<string>('mail.user');
    const password = config.get<string>('mail.password');
    const fromAddress = config.get<string>('mail.fromAddress') ?? 'atlas@labmgm.org';
    const fromName = config.get<string>('mail.fromName') ?? 'MGM Atlas';
    this.from = `"${fromName}" <${fromAddress}>`;

    if (host && port && user && password) {
      this.transporter = createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass: password },
      });
    } else {
      this.transporter = null;
      this.logger.warn('Mailer disabled — SMTP credentials not configured.');
    }
  }

  async send(opts: SendOptions): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`Skipping send to ${opts.to} — mailer disabled.`);
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: Array.isArray(opts.to) ? opts.to.join(', ') : opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      });
    } catch (err) {
      this.logger.error(`Mail send failed: ${(err as Error).message}`);
    }
  }
}
