import {
  Body,
  Controller,
  ForbiddenException,
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
import {
  ModerateKickDto,
  ModerateMoveDto,
  ModerateMuteDto,
} from '../dto/moderate-voice.dto';
import { VoiceFeatureFlagGuard } from '../guards/voice-feature-flag.guard';
import { VoiceModerationService } from '../services/voice-moderation.service';

/**
 * Per-channel moderation: server-side mute, kick, move. Access is
 * derived from the channel's projectId at request time:
 *   - Per-project channel → caller must be project manager (admin
 *     always passes via ProjectAccessService).
 *   - Lobby channel       → caller must be an Atlas admin (we check
 *     user.isAdmin inline since there's no project to gate on).
 *
 * Self-targeting is disallowed: moderators leave/mute themselves via
 * the regular controls.
 */
@ApiBearerAuth()
@ApiTags('voice')
@UseGuards(VoiceFeatureFlagGuard)
@Controller('voice/channels/:channelId/moderate')
export class VoiceModerationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly moderation: VoiceModerationService,
  ) {}

  @Post('mute')
  async mute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId') channelId: string,
    @Body() dto: ModerateMuteDto,
  ) {
    await this.assertCanModerate(channelId, user);
    if (dto.participantUserId === user.id) {
      throw new ForbiddenException('Use the mic button to mute yourself.');
    }
    return this.moderation.muteParticipant({
      channelId,
      targetUserId: dto.participantUserId,
      muted: dto.muted ?? true,
      actorUserId: user.id,
    });
  }

  @Post('kick')
  async kick(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId') channelId: string,
    @Body() dto: ModerateKickDto,
  ) {
    await this.assertCanModerate(channelId, user);
    if (dto.participantUserId === user.id) {
      throw new ForbiddenException('Use the leave button to leave a channel yourself.');
    }
    return this.moderation.kickParticipant({
      channelId,
      targetUserId: dto.participantUserId,
      actorUserId: user.id,
      reason: dto.reason,
    });
  }

  @Post('move')
  async move(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId') channelId: string,
    @Body() dto: ModerateMoveDto,
  ) {
    await this.assertCanModerate(channelId, user);
    if (dto.participantUserId === user.id) {
      throw new ForbiddenException('Switch channels yourself by clicking the destination.');
    }
    // Resolve the target user once so the moderation service can mint
    // a JWT with their identity + display name + avatar.
    const target = await this.prisma.user.findUnique({
      where: { id: dto.participantUserId },
      select: { id: true, name: true, avatarUrl: true },
    });
    if (!target) throw new NotFoundException('Target user not found.');

    return this.moderation.moveParticipant({
      sourceChannelId: channelId,
      targetChannelId: dto.targetChannelId,
      targetUserId: target.id,
      targetUserName: target.name,
      targetAvatarUrl: target.avatarUrl ?? null,
      actorUserId: user.id,
    });
  }

  /**
   * Derive the right gate from the channel's projectId:
   *   - projectId set → ProjectAccessService.assertManager
   *   - projectId null (lobby) → user.isAdmin
   */
  private async assertCanModerate(channelId: string, user: AuthenticatedUser) {
    const channel = await this.prisma.voiceChannel.findUnique({
      where: { id: channelId },
      select: { id: true, projectId: true, archivedAt: true },
    });
    if (!channel) throw new NotFoundException('Voice channel not found.');
    if (channel.archivedAt) {
      throw new ForbiddenException('This voice channel is archived.');
    }
    if (channel.projectId) {
      const { access } = await this.access.resolve(channel.projectId, user);
      this.access.assertManager(access);
    } else if (!user.isAdmin) {
      throw new ForbiddenException('Admin role required to moderate lobby channels.');
    }
  }
}
