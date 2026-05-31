import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { CreatePushSubscriptionDto } from './dto/push-subscription.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationsService } from './notifications.service';
import { PushDispatchService } from './push-dispatch.service';

@ApiBearerAuth()
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly push: PushDispatchService,
    private readonly prefs: NotificationPreferencesService,
  ) {}

  // ─── Bell + inbox (unchanged) ─────────────────────────────────────

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.notifications.list(user.id, Number(page) || 1, Number(pageSize) || 20);
  }

  @Get('unread-count')
  unread(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.unreadCount(user.id);
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user.id, id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user.id);
  }

  // ─── Web Push subscriptions ───────────────────────────────────────

  /**
   * Returns the VAPID public key the frontend feeds into
   * `pushManager.subscribe()`. Empty string when push isn't configured
   * yet — frontend uses this to hide the "Enable browser notifications"
   * UI instead of attempting a doomed subscribe.
   */
  @Get('push/vapid-public-key')
  @ApiOperation({ summary: 'VAPID public key for Web Push subscription' })
  getVapidPublicKey() {
    return { publicKey: this.push.getPublicKey(), configured: this.push.isConfigured() };
  }

  @Post('push/subscribe')
  @ApiOperation({ summary: 'Register a Web Push subscription for the current user' })
  subscribe(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePushSubscriptionDto) {
    return this.push.subscribe({
      userId: user.id,
      endpoint: dto.endpoint,
      p256dh: dto.p256dh,
      auth: dto.auth,
      userAgent: dto.userAgent,
    });
  }

  @Get('push/subscriptions')
  @ApiOperation({ summary: 'List devices that have an active push subscription' })
  listSubscriptions(@CurrentUser() user: AuthenticatedUser) {
    return this.push.listForUser(user.id);
  }

  @Delete('push/subscriptions/:id')
  @ApiOperation({ summary: 'Remove a push subscription owned by the current user' })
  unsubscribe(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.push.unsubscribe(user.id, id);
  }

  // ─── Preferences ──────────────────────────────────────────────────

  @Get('preferences')
  @ApiOperation({ summary: 'Get notification preferences (created with defaults on first read)' })
  getPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.prefs.getOrCreate(user.id);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Update one or more notification preference flags' })
  updatePreferences(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdatePreferencesDto) {
    return this.prefs.update(user.id, dto);
  }
}
