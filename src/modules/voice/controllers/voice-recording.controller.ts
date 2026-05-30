import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsBoolean } from 'class-validator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { PrismaService } from '@/prisma/prisma.service';
import { ProjectAccessService } from '@/modules/projects/project-access.service';
import { VoiceFeatureFlagGuard } from '../guards/voice-feature-flag.guard';
import { VoiceRecordingService } from '../services/voice-recording.service';

class StartRecordingDto {
  @IsOptional()
  @IsBoolean()
  audioOnly?: boolean;
}

/**
 * Recording lifecycle endpoints (Phase 7). All mod-only.
 *
 *   POST /api/v1/voice/channels/:id/recording/start  — mod
 *   POST /api/v1/voice/channels/:id/recording/stop   — mod
 *   GET  /api/v1/voice/channels/:id/recordings       — any insider (list)
 *   GET  /api/v1/voice/recordings/:id/download       — any insider, must
 *        be within the retention window
 *
 * Authorization mirrors the moderation controller: per-project channels
 * use ProjectAccessService.assertManager; lobby channels use
 * user.isAdmin.
 */
@ApiBearerAuth()
@ApiTags('voice')
@UseGuards(VoiceFeatureFlagGuard)
@Controller()
export class VoiceRecordingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly recording: VoiceRecordingService,
  ) {}

  @Post('voice/channels/:channelId/recording/start')
  async start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId') channelId: string,
    @Body() dto: StartRecordingDto,
  ) {
    await this.assertCanModerate(channelId, user);
    return this.recording.start({
      channelId,
      startedByUserId: user.id,
      audioOnly: dto.audioOnly,
    });
  }

  @Post('voice/channels/:channelId/recording/stop')
  async stop(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId') channelId: string,
  ) {
    await this.assertCanModerate(channelId, user);
    return this.recording.stop({ channelId });
  }

  @Get('voice/channels/:channelId/recordings')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId') channelId: string,
  ) {
    await this.assertCanRead(channelId, user);
    const items = await this.recording.listForChannel(channelId);
    return { items };
  }

  @Get('voice/recordings/:id/download')
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    // Reader-level gate — same channel access as list.
    const rec = await this.prisma.voiceRecording.findUnique({
      where: { id },
      select: { id: true, channelId: true },
    });
    if (!rec) throw new NotFoundException('Recording not found.');
    await this.assertCanRead(rec.channelId, user);
    return this.recording.downloadUrl(id);
  }

  // ─── Gating helpers ─────────────────────────────────────────────────

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
      throw new ForbiddenException('Admin role required for lobby recordings.');
    }
  }

  private async assertCanRead(channelId: string, user: AuthenticatedUser) {
    const channel = await this.prisma.voiceChannel.findUnique({
      where: { id: channelId },
      select: { id: true, projectId: true },
    });
    if (!channel) throw new NotFoundException('Voice channel not found.');
    if (channel.projectId) {
      const { access } = await this.access.resolve(channel.projectId, user);
      this.access.assertInsider(access);
    }
    // Lobby channels are open to any authenticated user (no extra check).
  }
}
