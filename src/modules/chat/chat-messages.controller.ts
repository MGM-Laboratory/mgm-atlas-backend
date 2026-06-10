import { Body, Controller, Delete, ForbiddenException, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { EditMessageDto } from './dto/edit-message.dto';
import { ForwardMessageDto } from './dto/forward-message.dto';
import { PinMessageDto } from './dto/pin-message.dto';
import { ReactMessageDto } from './dto/react-message.dto';
import { ChatChannelAccessService } from './services/chat-channel-access.service';
import { ChatMessagesService } from './services/chat-messages.service';
import { ChatPinsService } from './services/chat-pins.service';
import { ChatReactionsService } from './services/chat-reactions.service';
import { ChatRealtimePublisher } from './services/chat-realtime.publisher';

/**
 * Id-keyed message operations. These don't carry a project slug in the
 * path because the message itself encodes which channel (and therefore
 * which project — or the workspace-global scope when projectId is null)
 * it lives in; ChatChannelAccessService resolves access from the row.
 * On global channels every authenticated user is an insider and admins
 * are the managers/moderators.
 */
@ApiBearerAuth()
@ApiTags('chat')
@Controller('chat/messages')
export class ChatMessagesController {
  constructor(
    private readonly channelAccess: ChatChannelAccessService,
    private readonly messages: ChatMessagesService,
    private readonly reactions: ChatReactionsService,
    private readonly pins: ChatPinsService,
    private readonly realtime: ChatRealtimePublisher,
  ) {}

  @Patch(':id')
  async edit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: EditMessageDto,
  ) {
    const { access } = await this.channelAccess.resolveByMessageId(id, user);
    this.channelAccess.assertInsider(access);
    const { message, channelId } = await this.messages.edit(id, user, dto);
    this.realtime.messageEdited(channelId, message);
    return message;
  }

  @Delete(':id')
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const { access } = await this.channelAccess.resolveByMessageId(id, user);
    this.channelAccess.assertInsider(access);
    const { message, channelId } = await this.messages.delete(id, user, access.isManager);
    this.realtime.messageDeleted(channelId, message);
    return message;
  }

  @Post(':id/reactions')
  async react(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReactMessageDto,
  ) {
    const { access } = await this.channelAccess.resolveByMessageId(id, user);
    this.channelAccess.assertInsider(access);
    const result = await this.reactions.add(id, user.id, dto.emoji);
    this.realtime.reactionAdded(result.channelId, result.messageId, result.userId, result.emoji);
    return result;
  }

  @Delete(':id/reactions/:emoji')
  async unreact(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('emoji') emoji: string,
  ) {
    const { access } = await this.channelAccess.resolveByMessageId(id, user);
    this.channelAccess.assertInsider(access);
    const result = await this.reactions.remove(id, user.id, decodeURIComponent(emoji));
    this.realtime.reactionRemoved(result.channelId, result.messageId, result.userId, result.emoji);
    return result;
  }

  @Post(':id/pin')
  async pin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PinMessageDto = {},
  ) {
    const { access } = await this.channelAccess.resolveByMessageId(id, user);
    this.channelAccess.assertManager(access);
    const result = await this.pins.pin(id, user.id, dto.note);
    this.realtime.pinAdded(result.channelId, id, result.note ?? null);
    return result;
  }

  @Post(':id/unpin')
  async unpin(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const { access } = await this.channelAccess.resolveByMessageId(id, user);
    this.channelAccess.assertManager(access);
    const result = await this.pins.unpin(id);
    this.realtime.pinRemoved(result.channelId, id);
    return result;
  }

  @Post(':id/forward')
  async forward(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ForwardMessageDto,
  ) {
    // Source: must be an insider where the message lives.
    const source = await this.channelAccess.resolveByMessageId(id, user);
    this.channelAccess.assertInsider(source.access);

    // Target: resolve from the target channel, then require insider there too.
    const target = await this.channelAccess.resolveByChannelId(dto.targetChannelId, user);
    if (target.channel.isArchived) {
      throw new ForbiddenException('Cannot forward into an archived channel.');
    }
    this.channelAccess.assertInsider(target.access);

    const { message } = await this.messages.forward(id, dto.targetChannelId, user);
    this.realtime.messageCreated(dto.targetChannelId, target.channel.projectId, message);
    return message;
  }
}
