import { Module } from '@nestjs/common';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { ProjectsModule } from '@/modules/projects/projects.module';
import { ChatController } from './chat.controller';
import { ChatMessagesController } from './chat-messages.controller';
import { ChatOverviewController } from './chat-overview.controller';
import { ChatChannelsService } from './services/chat-channels.service';
import { ChatMessagesService } from './services/chat-messages.service';
import { ChatNotificationsService } from './services/chat-notifications.service';
import { ChatOverviewService } from './services/chat-overview.service';
import { ChatPinsService } from './services/chat-pins.service';
import { ChatReactionsService } from './services/chat-reactions.service';

/**
 * Realtime project chat (P1: REST + polling; sockets land in P2).
 *
 * Reuses `ProjectAccessService` from `ProjectsModule` for every access
 * decision and `NotificationsService` + `WebhooksService` (global)
 * for mention notifications and email dispatch.
 *
 * `ChatChannelsService` is exported so `ProjectsService.create` can
 * insert the auto-#general row inside its existing transaction.
 */
@Module({
  imports: [ProjectsModule, NotificationsModule],
  controllers: [ChatController, ChatMessagesController, ChatOverviewController],
  providers: [
    ChatChannelsService,
    ChatMessagesService,
    ChatReactionsService,
    ChatPinsService,
    ChatNotificationsService,
    ChatOverviewService,
  ],
  exports: [ChatChannelsService],
})
export class ChatModule {}
