import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth/auth.module';
import { MediaModule } from '@/modules/media/media.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { ProjectsModule } from '@/modules/projects/projects.module';
import { AdminStickersController } from './admin-stickers.controller';
import { ChatController } from './chat.controller';
import { ChatGifsController } from './chat-gifs.controller';
import { ChatLinkPreviewController } from './chat-link-preview.controller';
import { ChatMembersController } from './chat-members.controller';
import { ChatMessagesController } from './chat-messages.controller';
import { ChatOverviewController } from './chat-overview.controller';
import { ChatSearchController } from './chat-search.controller';
import { ChatStickersController } from './chat-stickers.controller';
import { QuickReplyController } from './quick-reply.controller';
import { ChatGateway } from './gateway/chat.gateway';
import { WsSessionGuard } from './gateway/ws-session.guard';
import { ChatAttachmentsService } from './services/chat-attachments.service';
import { ChatChannelsService } from './services/chat-channels.service';
import { ChatGifsService } from './services/chat-gifs.service';
import { ChatLinkPreviewService } from './services/chat-link-preview.service';
import { ChatMessagesService } from './services/chat-messages.service';
import { ChatNotificationsService } from './services/chat-notifications.service';
import { ChatOverviewService } from './services/chat-overview.service';
import { ChatPinsService } from './services/chat-pins.service';
import { ChatPresenceService } from './services/chat-presence.service';
import { ChatRealtimePublisher } from './services/chat-realtime.publisher';
import { ChatReactionsService } from './services/chat-reactions.service';
import { ChatSearchService } from './services/chat-search.service';
import { ChatStickersService } from './services/chat-stickers.service';
import { ChatTypingService } from './services/chat-typing.service';

/**
 * Realtime project chat. P1 shipped REST + polling. P2 adds the
 * WebSocket gateway (socket.io `/chat`), Redis-backed presence and
 * typing, and the realtime publisher that fans mutations out to
 * connected clients.
 *
 * Without Redis (REDIS_URL unset) the gateway still works on a single
 * instance; presence/typing degrade to in-memory; multi-instance
 * fanout is disabled.
 */
@Module({
  imports: [AuthModule, ProjectsModule, NotificationsModule, MediaModule],
  controllers: [
    ChatController,
    ChatMessagesController,
    ChatOverviewController,
    ChatLinkPreviewController,
    ChatGifsController,
    ChatMembersController,
    ChatStickersController,
    AdminStickersController,
    ChatSearchController,
    QuickReplyController,
  ],
  providers: [
    ChatChannelsService,
    ChatMessagesService,
    ChatReactionsService,
    ChatPinsService,
    ChatNotificationsService,
    ChatOverviewService,
    ChatPresenceService,
    ChatTypingService,
    ChatRealtimePublisher,
    ChatLinkPreviewService,
    ChatGifsService,
    ChatAttachmentsService,
    ChatStickersService,
    ChatSearchService,
    ChatGateway,
    WsSessionGuard,
  ],
  exports: [ChatChannelsService, ChatRealtimePublisher],
})
export class ChatModule {}
