import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { ProjectAccessService } from '@/modules/projects/project-access.service';
import { PrismaService } from '@/prisma/prisma.service';
import { EditMessageDto } from './dto/edit-message.dto';
import { ForwardMessageDto } from './dto/forward-message.dto';
import { PinMessageDto } from './dto/pin-message.dto';
import { ReactMessageDto } from './dto/react-message.dto';
import { ChatMessagesService } from './services/chat-messages.service';
import { ChatPinsService } from './services/chat-pins.service';
import { ChatReactionsService } from './services/chat-reactions.service';
import { ChatRealtimePublisher } from './services/chat-realtime.publisher';

/**
 * Id-keyed message operations. These don't carry a project slug in the
 * path because the message itself encodes which project it lives in;
 * we resolve project + access from the message row.
 */
@ApiBearerAuth()
@ApiTags('chat')
@Controller('chat/messages')
export class ChatMessagesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
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
    const projectId = await this.resolveProjectIdForMessage(id);
    const { access } = await this.access.resolve(projectId, user);
    this.access.assertInsider(access);
    const { message, channelId } = await this.messages.edit(id, user, dto);
    this.realtime.messageEdited(channelId, message);
    return message;
  }

  @Delete(':id')
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const projectId = await this.resolveProjectIdForMessage(id);
    const { access } = await this.access.resolve(projectId, user);
    this.access.assertInsider(access);
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
    const projectId = await this.resolveProjectIdForMessage(id);
    const { access } = await this.access.resolve(projectId, user);
    this.access.assertInsider(access);
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
    const projectId = await this.resolveProjectIdForMessage(id);
    const { access } = await this.access.resolve(projectId, user);
    this.access.assertInsider(access);
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
    const projectId = await this.resolveProjectIdForMessage(id);
    const { access } = await this.access.resolve(projectId, user);
    this.access.assertManager(access);
    const result = await this.pins.pin(id, user.id, dto.note);
    this.realtime.pinAdded(result.channelId, id, result.note ?? null);
    return result;
  }

  @Post(':id/unpin')
  async unpin(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const projectId = await this.resolveProjectIdForMessage(id);
    const { access } = await this.access.resolve(projectId, user);
    this.access.assertManager(access);
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
    // Source: must be an insider on the source project.
    const sourceProjectId = await this.resolveProjectIdForMessage(id);
    const sourceAccess = await this.access.resolve(sourceProjectId, user);
    this.access.assertInsider(sourceAccess.access);

    // Target: derive project from the target channel, then require insider on that too.
    const targetChannel = await this.prisma.chatChannel.findUnique({
      where: { id: dto.targetChannelId },
      select: { projectId: true, isArchived: true },
    });
    if (!targetChannel) throw new NotFoundException('Target channel not found.');
    if (targetChannel.isArchived) {
      throw new ForbiddenException('Cannot forward into an archived channel.');
    }
    const targetAccess = await this.access.resolve(targetChannel.projectId, user);
    this.access.assertInsider(targetAccess.access);

    const { message } = await this.messages.forward(id, dto.targetChannelId, user);
    this.realtime.messageCreated(dto.targetChannelId, targetChannel.projectId, message);
    return message;
  }

  private async resolveProjectIdForMessage(messageId: string) {
    const row = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { channel: { select: { projectId: true } } },
    });
    if (!row) throw new NotFoundException('Message not found.');
    return row.channel.projectId;
  }
}
