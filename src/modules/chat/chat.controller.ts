import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { ProjectAccessService } from '@/modules/projects/project-access.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { ListMessagesDto } from './dto/list-messages.dto';
import { PresignChatAttachmentDto } from './dto/presign-attachment.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { ChatAttachmentsService } from './services/chat-attachments.service';
import { ChatChannelsService } from './services/chat-channels.service';
import { ChatMessagesService } from './services/chat-messages.service';
import { ChatNotificationsService } from './services/chat-notifications.service';
import { ChatPinsService } from './services/chat-pins.service';
import { ChatRealtimePublisher } from './services/chat-realtime.publisher';

/**
 * Project-scoped chat endpoints. Every request resolves access via
 * ProjectAccessService — chat is hidden from anyone who isn't an insider
 * of the project (admin/PM/contributor). Viewers and guests get 403.
 */
@ApiBearerAuth()
@ApiTags('chat')
@Controller('projects/:slugOrId/chat')
export class ChatController {
  constructor(
    private readonly access: ProjectAccessService,
    private readonly channels: ChatChannelsService,
    private readonly messages: ChatMessagesService,
    private readonly pins: ChatPinsService,
    private readonly notifications: ChatNotificationsService,
    private readonly realtime: ChatRealtimePublisher,
    private readonly attachments: ChatAttachmentsService,
  ) {}

  // ─── Channels ────────────────────────────────────────────────────────

  @Get('channels')
  async listChannels(@CurrentUser() user: AuthenticatedUser, @Param('slugOrId') slugOrId: string) {
    const { projectId, access } = await this.access.resolve(slugOrId, user);
    this.access.assertInsider(access);
    return this.channels.list(projectId);
  }

  @Post('channels')
  async createChannel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slugOrId') slugOrId: string,
    @Body() dto: CreateChannelDto,
  ) {
    const { projectId, access } = await this.access.resolve(slugOrId, user);
    this.access.assertManager(access);
    const channel = await this.channels.create(projectId, user, dto);
    this.realtime.channelCreated(projectId, channel);
    return channel;
  }

  @Patch('channels/:channelId')
  async updateChannel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slugOrId') slugOrId: string,
    @Param('channelId') channelId: string,
    @Body() dto: UpdateChannelDto,
  ) {
    const { projectId, access } = await this.access.resolve(slugOrId, user);
    this.access.assertManager(access);
    await this.assertChannelInProject(channelId, projectId);
    const channel = await this.channels.update(channelId, dto);
    this.realtime.channelUpdated(projectId, channel);
    return channel;
  }

  @Post('channels/:channelId/archive')
  async archiveChannel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slugOrId') slugOrId: string,
    @Param('channelId') channelId: string,
  ) {
    const { projectId, access } = await this.access.resolve(slugOrId, user);
    this.access.assertManager(access);
    await this.assertChannelInProject(channelId, projectId);
    const channel = await this.channels.archive(channelId);
    this.realtime.channelArchived(projectId, channelId);
    return channel;
  }

  @Post('channels/:channelId/unarchive')
  async unarchiveChannel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slugOrId') slugOrId: string,
    @Param('channelId') channelId: string,
  ) {
    const { projectId, access } = await this.access.resolve(slugOrId, user);
    this.access.assertManager(access);
    await this.assertChannelInProject(channelId, projectId);
    const channel = await this.channels.unarchive(channelId);
    this.realtime.channelUpdated(projectId, channel);
    return channel;
  }

  // ─── Messages ────────────────────────────────────────────────────────

  @Get('channels/:channelId/messages')
  async listMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slugOrId') slugOrId: string,
    @Param('channelId') channelId: string,
    @Query() query: ListMessagesDto,
  ) {
    const { projectId, access } = await this.access.resolve(slugOrId, user);
    this.access.assertInsider(access);
    await this.assertChannelInProject(channelId, projectId);
    return this.messages.list(channelId, query.cursor, query.limit ?? 50);
  }

  @Post('channels/:channelId/messages')
  async createMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slugOrId') slugOrId: string,
    @Param('channelId') channelId: string,
    @Body() dto: CreateMessageDto,
  ) {
    const { projectId, access } = await this.access.resolve(slugOrId, user);
    this.access.assertInsider(access);
    await this.assertChannelInProject(channelId, projectId);

    const { message, mentions } = await this.messages.create(channelId, projectId, user, dto);
    this.realtime.messageCreated(channelId, projectId, message, dto.clientMessageId);
    await this.notifications.onMessageCreated({
      projectId,
      channelId,
      message,
      mentions,
      author: user,
    });
    return { ...message, clientMessageId: dto.clientMessageId };
  }

  @Post('channels/:channelId/read')
  async markChannelRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slugOrId') slugOrId: string,
    @Param('channelId') channelId: string,
    @Body() body: { lastReadMessageId?: string } = {},
  ) {
    const { projectId, access } = await this.access.resolve(slugOrId, user);
    this.access.assertInsider(access);
    await this.assertChannelInProject(channelId, projectId);
    await this.channels.markRead(channelId, user.id, body.lastReadMessageId);
    return { ok: true };
  }

  @Get('channels/:channelId/pins')
  async listPins(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slugOrId') slugOrId: string,
    @Param('channelId') channelId: string,
  ) {
    const { projectId, access } = await this.access.resolve(slugOrId, user);
    this.access.assertInsider(access);
    await this.assertChannelInProject(channelId, projectId);
    return this.pins.list(channelId);
  }

  // ─── Attachments ─────────────────────────────────────────────────────

  /**
   * Presigned PUT URL for a chat attachment upload. Client PUTs the
   * file to `uploadUrl` and includes the returned `s3Key`/`publicUrl`/
   * `kind` in the message body's `attachments` array.
   */
  @Post('channels/:channelId/attachments/presign')
  async presignAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slugOrId') slugOrId: string,
    @Param('channelId') channelId: string,
    @Body() dto: PresignChatAttachmentDto,
  ) {
    const { projectId, access } = await this.access.resolve(slugOrId, user);
    this.access.assertInsider(access);
    await this.assertChannelInProject(channelId, projectId);
    return this.attachments.presign(channelId, dto);
  }

  /**
   * Project-level access was already proven; this confirms the channelId
   * actually belongs to that project so a curious user can't read
   * another project's channel by mixing param values.
   */
  private async assertChannelInProject(channelId: string, projectId: string) {
    const channel = await this.channels.findById(channelId);
    if (channel.projectId !== projectId) {
      throw new NotFoundException('Channel not found.');
    }
  }
}
