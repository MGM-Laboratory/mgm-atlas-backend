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
import { ProjectAccessService } from '@/modules/projects/project-access.service';
import { CreateVoiceChannelDto } from '../dto/create-voice-channel.dto';
import { UpdateVoiceChannelDto } from '../dto/update-voice-channel.dto';
import { VoiceFeatureFlagGuard } from '../guards/voice-feature-flag.guard';
import { VoiceChannelsService } from '../services/voice-channels.service';
import { VoiceParticipantsService } from '../services/voice-participants.service';
import { VoiceRealtimePublisher } from '../services/voice-realtime.publisher';

/**
 * Per-project voice channels. Mirrors the chat channel controller's
 * access pattern: list is gated by insider, mutate by manager (admin
 * always passes).
 */
@ApiBearerAuth()
@ApiTags('voice')
@UseGuards(VoiceFeatureFlagGuard)
@Controller('projects/:slugOrId/voice/channels')
export class VoiceChannelsController {
  constructor(
    private readonly access: ProjectAccessService,
    private readonly channels: VoiceChannelsService,
    private readonly participants: VoiceParticipantsService,
    private readonly realtime: VoiceRealtimePublisher,
  ) {}

  /** List voice channels for a project (insider-only). */
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slugOrId') slugOrId: string,
  ) {
    const { projectId, access } = await this.access.resolve(slugOrId, user);
    this.access.assertInsider(access);
    const channels = await this.channels.listForProject(projectId);
    // Attach live roster per channel so the sidebar can render stacked
    // avatars without a second round-trip. Small N (channels per
    // project ≤ ~10), so the N+1 query is fine.
    const withRoster = await Promise.all(
      channels.map(async (c) => ({
        ...c,
        participants: await this.participants.listLive(c.id),
      })),
    );
    return { items: withRoster };
  }

  /** Create a new voice channel (manager-only). */
  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slugOrId') slugOrId: string,
    @Body() dto: CreateVoiceChannelDto,
  ) {
    const { projectId, access } = await this.access.resolve(slugOrId, user);
    this.access.assertManager(access);
    const channel = await this.channels.create(projectId, user.id, dto);
    this.realtime.channelCreated(channel);
    return channel;
  }

  /** Edit channel settings (manager-only). */
  @Patch(':channelId')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slugOrId') slugOrId: string,
    @Param('channelId') channelId: string,
    @Body() dto: UpdateVoiceChannelDto,
  ) {
    const { access } = await this.access.resolve(slugOrId, user);
    this.access.assertManager(access);
    const channel = await this.channels.update(channelId, dto);
    this.realtime.channelUpdated(channel);
    return channel;
  }

  /** Archive (soft-delete) a channel (manager-only). */
  @Delete(':channelId')
  async archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slugOrId') slugOrId: string,
    @Param('channelId') channelId: string,
  ) {
    const { projectId, access } = await this.access.resolve(slugOrId, user);
    this.access.assertManager(access);
    const archived = await this.channels.archive(channelId);
    this.realtime.channelArchived({ id: channelId, projectId });
    return archived;
  }
}
