import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { AdminGuard } from '@/modules/auth/guards/admin.guard';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { ChatChannelsService } from './services/chat-channels.service';
import { ChatRealtimePublisher } from './services/chat-realtime.publisher';

/**
 * Workspace-global chat channels (ChatChannel.projectId = null). Every
 * authenticated user can read them and post in them (message routes
 * live in ChatChannelOpsController); only admins can manage them —
 * mirrors VoiceLobbyController. The workspace #general is lazy-ensured
 * on first list so no migration backfill is needed.
 */
@ApiBearerAuth()
@ApiTags('chat')
@Controller('chat/global')
export class ChatGlobalController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChatChannelsService,
    private readonly realtime: ChatRealtimePublisher,
  ) {}

  @Get('channels')
  async listChannels(@CurrentUser() user: AuthenticatedUser) {
    await this.channels.ensureGlobalGeneral(user.id);
    return this.channels.listGlobal();
  }

  @UseGuards(AdminGuard)
  @Post('channels')
  async createChannel(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateChannelDto) {
    const channel = await this.channels.createGlobal(user, dto);
    this.realtime.channelCreated(null, channel);
    return channel;
  }

  @UseGuards(AdminGuard)
  @Patch('channels/:channelId')
  async updateChannel(@Param('channelId') channelId: string, @Body() dto: UpdateChannelDto) {
    await this.assertGlobalChannel(channelId);
    const channel = await this.channels.update(channelId, dto);
    this.realtime.channelUpdated(null, channel);
    return channel;
  }

  @UseGuards(AdminGuard)
  @Post('channels/:channelId/archive')
  async archiveChannel(@Param('channelId') channelId: string) {
    await this.assertGlobalChannel(channelId);
    const channel = await this.channels.archive(channelId);
    this.realtime.channelArchived(null, channelId);
    return channel;
  }

  @UseGuards(AdminGuard)
  @Post('channels/:channelId/unarchive')
  async unarchiveChannel(@Param('channelId') channelId: string) {
    await this.assertGlobalChannel(channelId);
    const channel = await this.channels.unarchive(channelId);
    this.realtime.channelUpdated(null, channel);
    return channel;
  }

  /**
   * @mention autocomplete for global channels. Everyone can read/write
   * them, so the candidate pool is the whole user base (vs the
   * project-member pool in ChatMembersController). Same wire shape.
   */
  @Get('members')
  async searchMembers(@Query('q') q?: string) {
    const term = (q ?? '').trim().toLowerCase();
    const users = await this.prisma.user.findMany({
      where: term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { email: { contains: term, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { name: 'asc' },
      take: 20,
      select: { id: true, name: true, avatarUrl: true },
    });
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      avatarUrl: u.avatarUrl,
      role: null,
      title: null,
    }));
  }

  /**
   * The admin gate already passed; this confirms the channel really is
   * a workspace-global one so the global routes can't be used to manage
   * project channels (mirrors assertChannelInProject).
   */
  private async assertGlobalChannel(channelId: string) {
    const channel = await this.channels.findById(channelId);
    if (channel.projectId !== null) {
      throw new NotFoundException('Channel not found.');
    }
  }
}
