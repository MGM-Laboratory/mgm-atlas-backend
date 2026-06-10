import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { PrismaService } from '@/prisma/prisma.service';
import { ProjectAccessService } from '@/modules/projects/project-access.service';
import { VoiceFeatureFlagGuard } from '../guards/voice-feature-flag.guard';
import { VoiceChannelsService } from '../services/voice-channels.service';
import { VoiceParticipantsService } from '../services/voice-participants.service';
import { VoiceRealtimePublisher } from '../services/voice-realtime.publisher';

/**
 * Join / leave flow for a voice channel — applies to both per-project
 * channels and workspace-lobby channels (projectId = null). Access:
 *   - Per-project channel → caller must be a project insider.
 *   - Lobby channel        → any authenticated Atlas user.
 *
 * The route is intentionally NOT nested under /projects/:slug — the
 * client only knows the channelId, and joining is a per-channel
 * operation. Access is resolved from the channel's own projectId.
 */
@ApiBearerAuth()
@ApiTags('voice')
@UseGuards(VoiceFeatureFlagGuard)
@Controller('voice/channels/:channelId')
export class VoiceJoinController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly channels: VoiceChannelsService,
    private readonly participants: VoiceParticipantsService,
    private readonly realtime: VoiceRealtimePublisher,
  ) {}

  /** Join: mint a LiveKit JWT scoped to this channel's room. */
  @Post('join')
  async join(@CurrentUser() user: AuthenticatedUser, @Param('channelId') channelId: string) {
    const channel = await this.prisma.voiceChannel.findUnique({
      where: { id: channelId },
      select: { id: true, projectId: true, archivedAt: true, name: true },
    });
    if (!channel) throw new NotFoundException('Voice channel not found.');
    if (channel.archivedAt) {
      throw new ForbiddenException('This voice channel is archived.');
    }

    // Access check: project channels need insider; lobby channels are
    // open to any authenticated user. Capture canModerate so the
    // participants service can default them to SPEAKER in STAGE
    // channels (managers/admins always speak; everyone else is
    // audience until promoted).
    let canModerate = user.isAdmin;
    if (channel.projectId) {
      const { access } = await this.access.resolve(channel.projectId, user);
      this.access.assertInsider(access);
      canModerate = access.isManager;
    }

    const envelope = await this.participants.join({
      channelId: channel.id,
      userId: user.id,
      userName: user.name,
      avatarUrl: user.avatarUrl ?? null,
      canModerate,
    });

    this.realtime.participantJoined(channel.id, channel.projectId, {
      userId: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl ?? null,
      joinedAt: envelope.participant.joinedAt,
    });

    return envelope;
  }

  /** Leave: close the participant row. Idempotent. */
  @Post('leave')
  async leave(@CurrentUser() user: AuthenticatedUser, @Param('channelId') channelId: string) {
    const channel = await this.prisma.voiceChannel.findUnique({
      where: { id: channelId },
      select: { id: true, projectId: true },
    });
    if (!channel) throw new NotFoundException('Voice channel not found.');
    const result = await this.participants.leave({ channelId, userId: user.id });
    if (result.left) {
      this.realtime.participantLeft(channel.id, channel.projectId, { userId: user.id });
    }
    return result;
  }

  /**
   * Resolve the paired ChatChannel id for a voice channel's text
   * thread (§10). Lobby channels' threads are workspace-global
   * ChatChannels (projectId = null); lobby channels created before
   * 13_workspace_global_chat get theirs lazily backfilled here on
   * first open.
   *
   * Access mirrors join: per-project channels gated by insider;
   * lobby channels are open to any authenticated user.
   */
  @Get('thread')
  async getThread(@CurrentUser() user: AuthenticatedUser, @Param('channelId') channelId: string) {
    const channel = await this.prisma.voiceChannel.findUnique({
      where: { id: channelId },
      select: {
        id: true,
        projectId: true,
        archivedAt: true,
        textThreadId: true,
        project: { select: { slug: true } },
      },
    });
    if (!channel) throw new NotFoundException('Voice channel not found.');
    if (channel.archivedAt) {
      throw new ForbiddenException('This voice channel is archived.');
    }
    if (channel.projectId) {
      const { access } = await this.access.resolve(channel.projectId, user);
      this.access.assertInsider(access);
    }
    let threadId = channel.textThreadId;
    if (!threadId) {
      if (channel.projectId) {
        // Project channel pre-dating the Phase 4 backfill — the seed
        // script handles these; don't create threads on the read path.
        throw new NotFoundException('No text thread for this voice channel.');
      }
      threadId = await this.channels.ensureLobbyThread(channel.id);
    }
    return {
      chatChannelId: threadId,
      projectId: channel.projectId,
      projectSlug: channel.project?.slug ?? null,
    };
  }
}
