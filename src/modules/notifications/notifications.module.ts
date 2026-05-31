import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth/auth.module';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsRealtimePublisher } from './notifications-realtime.publisher';
import { NotificationsService } from './notifications.service';
import { PushDispatchService } from './push-dispatch.service';

/**
 * Notifications module — owns:
 *  - Persisted Notification rows (DB source of truth for the bell).
 *  - `/notifications` socket.io namespace for live in-app delivery.
 *  - PushSubscription registry + Web Push dispatch (VAPID-keyed; no-op
 *    when env unset so the module ships dark safely).
 *  - NotificationPreference per-user toggles.
 *
 * Other modules import this for `NotificationsService` and call
 * `.notify()` to deliver persisted + live + push in one go.
 */
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsRealtimePublisher,
    NotificationsGateway,
    NotificationPreferencesService,
    PushDispatchService,
  ],
  exports: [NotificationsService, NotificationPreferencesService, PushDispatchService],
})
export class NotificationsModule {}
