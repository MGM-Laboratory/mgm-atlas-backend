import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { AdminGuard } from '@/modules/auth/guards/admin.guard';
import { CreateVoiceChannelDto } from '../dto/create-voice-channel.dto';
import { UpdateVoiceChannelDto } from '../dto/update-voice-channel.dto';
import { VoiceFeatureFlagGuard } from '../guards/voice-feature-flag.guard';
import { VoiceChannelsService } from '../services/voice-channels.service';
import { VoiceParticipantsService } from '../services/voice-participants.service';
import { VoiceRealtimePublisher } from '../services/voice-realtime.publisher';

/**
 * Workspace-wide voice lobby (channels with projectId = null).
 *
 * Reads: any authenticated Atlas user.
 * Mutations: admin-only (AdminGuard, `user.isAdmin === true`).
 *
 * Mirrors the per-project controller but skips the ProjectAccessService
 * dance — the lobby has no project to gate on.
 */
@ApiBearerAuth()
@ApiTags('voice')
@UseGuards(VoiceFeatureFlagGuard)
@Controller('voice/lobby/channels')
export class VoiceLobbyController {
  constructor(
    private readonly channels: VoiceChannelsService,
    private readonly participants: VoiceParticipantsService,
    private readonly realtime: VoiceRealtimePublisher,
  ) {}

  /** List lobby channels — any authenticated user. */
  @Get()
  async list() {
    const channels = await this.channels.listLobby();
    const withRoster = await Promise.all(
      channels.map(async (c) => ({
        ...c,
        participants: await this.participants.listLive(c.id),
      })),
    );
    return { items: withRoster };
  }

  @UseGuards(AdminGuard)
  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateVoiceChannelDto,
  ) {
    const channel = await this.channels.createLobby(user.id, dto);
    this.realtime.channelCreated(channel);
    return channel;
  }

  @UseGuards(AdminGuard)
  @Patch(':channelId')
  async update(
    @Param('channelId') channelId: string,
    @Body() dto: UpdateVoiceChannelDto,
  ) {
    const channel = await this.channels.update(channelId, dto);
    this.realtime.channelUpdated(channel);
    return channel;
  }

  @UseGuards(AdminGuard)
  @Delete(':channelId')
  async archive(@Param('channelId') channelId: string) {
    const archived = await this.channels.archive(channelId);
    this.realtime.channelArchived({ id: channelId, projectId: null });
    return archived;
  }
}
