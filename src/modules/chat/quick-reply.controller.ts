import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { QuickReplyDto } from './dto/quick-reply.dto';
import { ChatChannelAccessService } from './services/chat-channel-access.service';
import { ChatMessagesService } from './services/chat-messages.service';
import { ChatNotificationsService } from './services/chat-notifications.service';
import { ChatRealtimePublisher } from './services/chat-realtime.publisher';

/**
 * `POST /notifications/:id/quick-reply` — the inline-reply-from-notification
 * landing endpoint, fired by the service worker when a user types in
 * the OS-level notification's reply input (Chromium browsers' Web Push
 * `actions: [{ action: 'reply', type: 'text' }]` flow).
 *
 * Lives in chat module (not notifications) because every supported
 * notification type currently resolves to a chat message — so this
 * controller already has the right services injected and we avoid
 * widening NotificationsModule's exports surface. If task-comment
 * quick-reply ever ships, that path can be added here too without
 * the SW caring about the routing.
 *
 * Mounted on the `/notifications` REST prefix so the SW can send to a
 * stable URL regardless of which underlying service handles the reply.
 */
@ApiBearerAuth()
@ApiTags('notifications')
@Controller('notifications')
export class QuickReplyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly channelAccess: ChatChannelAccessService,
    private readonly messages: ChatMessagesService,
    private readonly realtime: ChatRealtimePublisher,
    private readonly chatNotifications: ChatNotificationsService,
  ) {}

  @Post(':id/quick-reply')
  @ApiOperation({
    summary: 'Reply inline from a notification banner (Chromium SW path)',
  })
  async reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QuickReplyDto,
  ) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId: user.id },
      select: { id: true, type: true, metadata: true, link: true },
    });
    if (!notification) throw new NotFoundException('Notification not found.');

    // Only chat-style notifications are routable right now. Other types
    // (project invites, task assignments without a comment context, etc.)
    // would need their own resolution paths; for now we 400 so the SW
    // can show a fallback to the user.
    if (notification.type !== 'CHAT_MENTION') {
      throw new BadRequestException(
        'Quick-reply is only available on chat mentions in this release.',
      );
    }

    const meta = (notification.metadata ?? {}) as Record<string, unknown>;
    const channelId = typeof meta.channelId === 'string' ? meta.channelId : null;
    if (!channelId) {
      throw new BadRequestException('Notification is missing chat routing metadata.');
    }

    // Walk the same access check the regular chat POST does so a stale
    // notification (e.g. user removed from project after it fired) doesn't
    // let them write into a channel they no longer belong to. Resolving
    // by channelId (not metadata projectId) also covers workspace-global
    // channels, whose metadata carries projectId: null.
    const { channel, access } = await this.channelAccess.resolveByChannelId(channelId, user);
    try {
      this.channelAccess.assertInsider(access);
    } catch {
      throw new ForbiddenException('You no longer have access to this chat.');
    }
    const projectId = channel.projectId;

    // Replicate the exact create→publish→mention pipeline used by
    // chat.controller.createMessage so a quick-reply is indistinguishable
    // from a normal message to every other observer.
    const createDto = new CreateMessageDto();
    createDto.markdown = dto.text;
    const { message, mentions } = await this.messages.create(channelId, projectId, user, createDto);
    this.realtime.messageCreated(channelId, projectId, message);
    await this.chatNotifications.onMessageCreated({
      projectId,
      channelId,
      message,
      mentions,
      author: user,
    });

    // Mark the source notification read — the user just acted on it.
    await this.notifications.markRead(user.id, notification.id);

    return {
      ok: true,
      messageId: message.id,
      channelId,
      projectId,
      link:
        notification.link ??
        (projectId ? `/projects/${projectId}/chat/${channelId}` : `/chat/global/${channelId}`),
    };
  }
}
