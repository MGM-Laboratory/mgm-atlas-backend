import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { CreateMessageDto } from './dto/create-message.dto';
import { ListMessagesDto } from './dto/list-messages.dto';
import { PresignChatAttachmentDto } from './dto/presign-attachment.dto';
import { ChatAttachmentsService } from './services/chat-attachments.service';
import { ChatChannelAccessService } from './services/chat-channel-access.service';
import { ChatChannelsService } from './services/chat-channels.service';
import { ChatMessagesService } from './services/chat-messages.service';
import { ChatNotificationsService } from './services/chat-notifications.service';
import { ChatPinsService } from './services/chat-pins.service';
import { ChatRealtimePublisher } from './services/chat-realtime.publisher';

/**
 * Channel-id-keyed message operations. Unlike ChatController these
 * don't carry a project slug — access is resolved from the channel row
 * itself via ChatChannelAccessService, so the same routes serve
 * workspace-global channels (the workspace #general, lobby voice text
 * threads) and project channels alike. Wire shapes are identical to
 * the project-scoped equivalents.
 */
@ApiBearerAuth()
@ApiTags('chat')
@Controller('chat/channels/:channelId')
export class ChatChannelOpsController {
  constructor(
    private readonly channelAccess: ChatChannelAccessService,
    private readonly channels: ChatChannelsService,
    private readonly messages: ChatMessagesService,
    private readonly pins: ChatPinsService,
    private readonly notifications: ChatNotificationsService,
    private readonly realtime: ChatRealtimePublisher,
    private readonly attachments: ChatAttachmentsService,
  ) {}

  @Get('messages')
  async listMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId') channelId: string,
    @Query() query: ListMessagesDto,
  ) {
    const { access } = await this.channelAccess.resolveByChannelId(channelId, user);
    this.channelAccess.assertInsider(access);
    return this.messages.list(channelId, query.cursor, query.limit ?? 50);
  }

  @Post('messages')
  async createMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId') channelId: string,
    @Body() dto: CreateMessageDto,
  ) {
    const { channel, access } = await this.channelAccess.resolveByChannelId(channelId, user);
    this.channelAccess.assertInsider(access);

    const { message, mentions } = await this.messages.create(
      channelId,
      channel.projectId,
      user,
      dto,
    );
    this.realtime.messageCreated(channelId, channel.projectId, message, dto.clientMessageId);
    await this.notifications.onMessageCreated({
      projectId: channel.projectId,
      channelId,
      message,
      mentions,
      author: user,
    });
    return { ...message, clientMessageId: dto.clientMessageId };
  }

  @Post('read')
  async markChannelRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId') channelId: string,
    @Body() body: { lastReadMessageId?: string } = {},
  ) {
    const { access } = await this.channelAccess.resolveByChannelId(channelId, user);
    this.channelAccess.assertInsider(access);
    await this.channels.markRead(channelId, user.id, body.lastReadMessageId);
    return { ok: true };
  }

  /** Same contract as ChatController's channel `state` endpoint. */
  @Get('state')
  async channelState(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId') channelId: string,
  ) {
    const { access } = await this.channelAccess.resolveByChannelId(channelId, user);
    this.channelAccess.assertInsider(access);
    return this.channels.getMemberState(channelId, user.id);
  }

  @Get('pins')
  async listPins(@CurrentUser() user: AuthenticatedUser, @Param('channelId') channelId: string) {
    const { access } = await this.channelAccess.resolveByChannelId(channelId, user);
    this.channelAccess.assertInsider(access);
    return this.pins.list(channelId);
  }

  @Post('attachments/presign')
  async presignAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId') channelId: string,
    @Body() dto: PresignChatAttachmentDto,
  ) {
    const { access } = await this.channelAccess.resolveByChannelId(channelId, user);
    this.channelAccess.assertInsider(access);
    return this.attachments.presign(channelId, dto);
  }
}
