import { Injectable, Logger } from '@nestjs/common';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { WebhooksService } from '@/modules/webhooks/webhooks.service';
import { PrismaService } from '@/prisma/prisma.service';
import type { ChatMessagePublic } from './chat-messages.service';

interface OnMessageCreatedInput {
  projectId: string;
  channelId: string;
  message: ChatMessagePublic;
  mentions: string[];
  author: AuthenticatedUser;
}

/**
 * Fans chat events out to:
 *   - the in-app notification bell (NotificationsService)
 *   - n8n via WebhooksService (n8n composes & sends user-facing email)
 *
 * Deliberately decoupled from the realtime gateway: the gateway emits
 * socket frames to currently-connected listeners; this service handles
 * the "user wasn't watching" case (badges + email).
 *
 * Chat webhook events are reported as a string event type to keep
 * WebhooksService's existing union additive — we don't widen the
 * AtlasWebhookEvent type until P5 polish.
 */
@Injectable()
export class ChatNotificationsService {
  private readonly logger = new Logger(ChatNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhooksService,
  ) {}

  async onMessageCreated(input: OnMessageCreatedInput) {
    const { projectId, channelId, message, mentions, author } = input;
    const recipients = await this.resolveRecipients(projectId, mentions, author.id);
    if (recipients.length === 0) return;

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { slug: true, title: true },
    });
    if (!project) return;

    const channel = await this.prisma.chatChannel.findUnique({
      where: { id: channelId },
      select: { name: true },
    });
    const channelName = channel?.name ?? 'channel';

    await this.notifications.createMany(
      recipients.map((u) => ({
        userId: u.id,
        type: 'CHAT_MENTION',
        title: `@${author.name} mentioned you in #${channelName}`,
        body: this.preview(message.markdown),
        link: `/projects/${project.slug}/chat/${channelId}`,
        metadata: { messageId: message.id, channelId, projectId },
      })),
    );

    // Webhook to n8n for email composition. Cast through unknown to
    // sidestep the AtlasWebhookEvent type union until P5 widens it.
    void this.webhooks
      .dispatch('chat.user_mentioned' as unknown as 'project.invited', {
        projectSlug: project.slug,
        projectTitle: project.title,
        channelName,
        channelId,
        messageId: message.id,
        preview: this.preview(message.markdown),
        author: { id: author.id, name: author.name, email: author.email },
        recipients,
      })
      .catch((err) =>
        this.logger.warn(`chat.user_mentioned webhook failed: ${(err as Error).message}`),
      );
  }

  private async resolveRecipients(projectId: string, mentionIds: string[], authorId: string) {
    if (mentionIds.length === 0) return [];
    // Only notify mentioned users who actually have access to the project.
    // Admins always have access; non-admins must be a project member.
    return this.prisma.user.findMany({
      where: {
        id: { in: mentionIds.filter((id) => id !== authorId) },
        OR: [{ isAdmin: true }, { memberships: { some: { projectId } } }],
      },
      select: { id: true, name: true, email: true },
    });
  }

  private preview(markdown: string): string {
    return markdown.replace(/\s+/g, ' ').trim().slice(0, 200);
  }
}
