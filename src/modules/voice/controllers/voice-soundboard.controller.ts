import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { AdminGuard } from '@/modules/auth/guards/admin.guard';
import {
  PresignSoundboardClipDto,
  RegisterSoundboardClipDto,
} from '../dto/soundboard.dto';
import { VoiceFeatureFlagGuard } from '../guards/voice-feature-flag.guard';
import { VoiceSoundboardService } from '../services/voice-soundboard.service';

/**
 * Workspace-wide voice soundboard.
 *
 * Reads: any authenticated Atlas user (soundboard is universal).
 * Mutations: admin-only (AdminGuard). PMs intentionally cannot upload
 * — keeping the library curated. This matches the lobby controller's
 * gating pattern.
 *
 * Playback is purely client-side: the frontend fetches the public
 * URL, decodes it, and publishes it to the LiveKit room as an extra
 * LocalAudioTrack. No "play" endpoint is needed here.
 */
@ApiBearerAuth()
@ApiTags('voice')
@UseGuards(VoiceFeatureFlagGuard)
@Controller('voice/soundboard/clips')
export class VoiceSoundboardController {
  constructor(private readonly soundboard: VoiceSoundboardService) {}

  @Get()
  async list() {
    return { items: await this.soundboard.list() };
  }

  @UseGuards(AdminGuard)
  @Post('presign')
  async presign(@Body() dto: PresignSoundboardClipDto) {
    return this.soundboard.presign(dto);
  }

  @UseGuards(AdminGuard)
  @Post()
  async register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterSoundboardClipDto,
  ) {
    return this.soundboard.register(user.id, dto);
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.soundboard.remove(id);
  }
}
