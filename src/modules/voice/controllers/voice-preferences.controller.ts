import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { UpdateVoicePreferencesDto } from '../dto/update-voice-preferences.dto';
import { VoiceFeatureFlagGuard } from '../guards/voice-feature-flag.guard';
import { VoicePreferencesService } from '../services/voice-preferences.service';

/**
 * Per-user voice settings (input mode, PTT, audio cleanup, devices,
 * volumes, keyboard shortcuts). One row per user, lazy-created on
 * first read.
 *
 * GET   /api/v1/voice/me/preferences  → returns the row (creates if missing)
 * PATCH /api/v1/voice/me/preferences  → partial update (upserts on first save)
 */
@ApiBearerAuth()
@ApiTags('voice')
@UseGuards(VoiceFeatureFlagGuard)
@Controller('voice/me/preferences')
export class VoicePreferencesController {
  constructor(private readonly preferences: VoicePreferencesService) {}

  @Get()
  async get(@CurrentUser() user: AuthenticatedUser) {
    return this.preferences.getOrCreate(user.id);
  }

  @Patch()
  async patch(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateVoicePreferencesDto,
  ) {
    return this.preferences.update(user.id, dto);
  }
}
