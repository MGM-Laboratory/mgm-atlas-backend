import { Injectable } from '@nestjs/common';
import { Prisma, VoiceUserPreferences } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { UpdateVoicePreferencesDto } from '../dto/update-voice-preferences.dto';

/**
 * CRUD for the per-user VoiceUserPreferences row. Lazy-creates the row
 * on first read so callers never have to worry about whether it
 * exists — the table fills in organically as users open the voice
 * settings dialog for the first time.
 */
@Injectable()
export class VoicePreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Get or create the user's row. Idempotent. */
  async getOrCreate(userId: string): Promise<VoiceUserPreferences> {
    return this.prisma.voiceUserPreferences.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  /**
   * Apply a partial update. Unknown / undefined fields are left alone.
   * Empty string for a nullable field clears it (null in DB).
   */
  async update(
    userId: string,
    dto: UpdateVoicePreferencesDto,
  ): Promise<VoiceUserPreferences> {
    const data: Prisma.VoiceUserPreferencesUpdateInput = {};
    if (dto.inputMode !== undefined) data.inputMode = dto.inputMode;
    if (dto.pttKey !== undefined) data.pttKey = dto.pttKey || null;
    if (dto.pttReleaseMs !== undefined) data.pttReleaseMs = dto.pttReleaseMs;
    if (dto.noiseSuppression !== undefined) data.noiseSuppression = dto.noiseSuppression;
    if (dto.echoCancellation !== undefined) data.echoCancellation = dto.echoCancellation;
    if (dto.autoGainControl !== undefined) data.autoGainControl = dto.autoGainControl;
    if (dto.micDeviceId !== undefined) data.micDeviceId = dto.micDeviceId || null;
    if (dto.cameraDeviceId !== undefined) data.cameraDeviceId = dto.cameraDeviceId || null;
    if (dto.outputDeviceId !== undefined) data.outputDeviceId = dto.outputDeviceId || null;
    if (dto.micVolume !== undefined) data.micVolume = dto.micVolume;
    if (dto.outputVolume !== undefined) data.outputVolume = dto.outputVolume;
    if (dto.shortcutMute !== undefined) data.shortcutMute = dto.shortcutMute || null;
    if (dto.shortcutDeafen !== undefined) data.shortcutDeafen = dto.shortcutDeafen || null;
    if (dto.shortcutDisconnect !== undefined)
      data.shortcutDisconnect = dto.shortcutDisconnect || null;

    return this.prisma.voiceUserPreferences.upsert({
      where: { userId },
      // Create-on-PATCH so the first save from the settings dialog
      // doesn't need a separate GET roundtrip first.
      create: {
        userId,
        ...(dto.inputMode !== undefined ? { inputMode: dto.inputMode } : {}),
        ...(dto.pttKey !== undefined ? { pttKey: dto.pttKey || null } : {}),
        ...(dto.pttReleaseMs !== undefined ? { pttReleaseMs: dto.pttReleaseMs } : {}),
        ...(dto.noiseSuppression !== undefined
          ? { noiseSuppression: dto.noiseSuppression }
          : {}),
        ...(dto.echoCancellation !== undefined
          ? { echoCancellation: dto.echoCancellation }
          : {}),
        ...(dto.autoGainControl !== undefined
          ? { autoGainControl: dto.autoGainControl }
          : {}),
        ...(dto.micDeviceId !== undefined ? { micDeviceId: dto.micDeviceId || null } : {}),
        ...(dto.cameraDeviceId !== undefined
          ? { cameraDeviceId: dto.cameraDeviceId || null }
          : {}),
        ...(dto.outputDeviceId !== undefined
          ? { outputDeviceId: dto.outputDeviceId || null }
          : {}),
        ...(dto.micVolume !== undefined ? { micVolume: dto.micVolume } : {}),
        ...(dto.outputVolume !== undefined ? { outputVolume: dto.outputVolume } : {}),
        ...(dto.shortcutMute !== undefined
          ? { shortcutMute: dto.shortcutMute || null }
          : {}),
        ...(dto.shortcutDeafen !== undefined
          ? { shortcutDeafen: dto.shortcutDeafen || null }
          : {}),
        ...(dto.shortcutDisconnect !== undefined
          ? { shortcutDisconnect: dto.shortcutDisconnect || null }
          : {}),
      },
      update: data,
    });
  }
}
