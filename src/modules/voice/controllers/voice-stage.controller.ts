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
import { IsOptional, IsUUID } from 'class-validator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { PrismaService } from '@/prisma/prisma.service';
import { ProjectAccessService } from '@/modules/projects/project-access.service';
import { VoiceFeatureFlagGuard } from '../guards/voice-feature-flag.guard';
import { VoiceStageService } from '../services/voice-stage.service';

/** Optional targetUserId (mods lowering someone else's hand). */
class LowerHandDto {
  @IsOptional()
  @IsUUID()
  targetUserId?: string;
}

class StageActionDto {
  @IsUUID()
  participantUserId!: string;
}

/**
 * Phase 8 — stage channel operations:
 *   POST /voice/channels/:id/hand/raise   — self (audience only)
 *   POST /voice/channels/:id/hand/lower   — self OR mod (targetUserId)
 *   GET  /voice/channels/:id/hand/queue   — any insider (queue list)
 *   POST /voice/channels/:id/stage/promote — mod
 *   POST /voice/channels/:id/stage/demote  — mod
 */
@ApiBearerAuth()
@ApiTags('voice')
@UseGuards(VoiceFeatureFlagGuard)
@Controller('voice/channels/:channelId')
export class VoiceStageController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly stage: VoiceStageService,
  ) {}

  @Post('hand/raise')
  async raiseHand(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId') channelId: string,
  ) {
    await this.assertCanRead(channelId, user);
    return this.stage.raiseHand({ channelId, userId: user.id });
  }

  @Post('hand/lower')
  async lowerHand(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId') channelId: string,
    @Body() dto: LowerHandDto,
  ) {
    const targetUserId = dto.targetUserId ?? user.id;
    const isMod =
      targetUserId !== user.id
        ? await this.isModerator(channelId, user)
        : false;
    if (targetUserId !== user.id && !isMod) {
      throw new ForbiddenException('Only moderators can lower other people\'s hands.');
    }
    await this.assertCanRead(channelId, user);
    return this.stage.lowerHand({
      channelId,
      targetUserId,
      actorUserId: user.id,
      actorIsModerator: isMod,
    });
  }

  @Get('hand/queue')
  async queue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId') channelId: string,
  ) {
    await this.assertCanRead(channelId, user);
    const items = await this.stage.listHandQueue(channelId);
    return { items };
  }

  @Post('stage/promote')
  async promote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId') channelId: string,
    @Body() dto: StageActionDto,
  ) {
    await this.assertCanModerate(channelId, user);
    return this.stage.promote({
      channelId,
      targetUserId: dto.participantUserId,
      actorUserId: user.id,
    });
  }

  @Post('stage/demote')
  async demote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId') channelId: string,
    @Body() dto: StageActionDto,
  ) {
    await this.assertCanModerate(channelId, user);
    return this.stage.demote({
      channelId,
      targetUserId: dto.participantUserId,
      actorUserId: user.id,
    });
  }

  // ─── Gating helpers ─────────────────────────────────────────────────

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
  }

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
      throw new ForbiddenException('Admin role required for lobby stage channels.');
    }
  }

  private async isModerator(
    channelId: string,
    user: AuthenticatedUser,
  ): Promise<boolean> {
    const channel = await this.prisma.voiceChannel.findUnique({
      where: { id: channelId },
      select: { projectId: true },
    });
    if (!channel) return false;
    if (channel.projectId) {
      try {
        const { access } = await this.access.resolve(channel.projectId, user);
        return access.isManager;
      } catch {
        return false;
      }
    }
    return user.isAdmin;
  }
}
