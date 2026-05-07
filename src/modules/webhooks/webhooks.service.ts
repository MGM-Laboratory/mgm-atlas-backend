import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '@/prisma/prisma.service';

export type AtlasWebhookEvent =
  | 'contribution.submitted'
  | 'contribution.approved'
  | 'contribution.rejected'
  | 'contribution.withdrawn'
  | 'project.invited'
  | 'project.member_added'
  | 'project.member_removed';

export interface WebhookEnvelope<T = unknown> {
  event: AtlasWebhookEvent;
  timestamp: string;
  source: 'atlas';
  data: T;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly url: string;
  private readonly secret: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const base = config.getOrThrow<string>('n8n.baseUrl').replace(/\/+$/, '');
    const path = config.get<string>('n8n.webhookPath') ?? '/webhook/atlas';
    this.url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    this.secret = config.getOrThrow<string>('n8n.secret');
  }

  /**
   * Fire-and-forget dispatch to n8n. The webhook is logged in WebhookDelivery
   * regardless of outcome. Failures are surfaced as warnings — they never
   * block the user-facing request, since email is async UX anyway.
   */
  async dispatch<T>(event: AtlasWebhookEvent, data: T): Promise<void> {
    const envelope: WebhookEnvelope<T> = {
      event,
      timestamp: new Date().toISOString(),
      source: 'atlas',
      data,
    };
    const body = JSON.stringify(envelope);
    const signature = createHmac('sha256', this.secret).update(body).digest('hex');

    const log = await this.prisma.webhookDelivery.create({
      data: { event, payload: envelope as object },
    });

    try {
      const res = await axios.post(this.url, envelope, {
        headers: {
          'content-type': 'application/json',
          'x-atlas-signature': signature,
          'x-atlas-event': event,
        },
        timeout: 10_000,
        validateStatus: () => true,
      });

      const succeeded = res.status >= 200 && res.status < 300;
      await this.prisma.webhookDelivery.update({
        where: { id: log.id },
        data: {
          status: res.status,
          responseBody: typeof res.data === 'string' ? res.data.slice(0, 4000) : JSON.stringify(res.data).slice(0, 4000),
          succeeded,
          completedAt: new Date(),
        },
      });

      if (!succeeded) {
        this.logger.warn(`n8n webhook ${event} returned ${res.status}`);
      }
    } catch (err) {
      this.logger.error(`n8n webhook ${event} failed: ${(err as Error).message}`);
      await this.prisma.webhookDelivery.update({
        where: { id: log.id },
        data: {
          succeeded: false,
          responseBody: (err as Error).message.slice(0, 4000),
          completedAt: new Date(),
        },
      });
    }
  }
}
