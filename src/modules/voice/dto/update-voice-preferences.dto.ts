import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { VoiceInputMode } from '@prisma/client';

/**
 * Partial update for the user's voice preferences. Every field is
 * optional — clients PATCH only what they're changing. The backend
 * keeps unchanged fields at their current values.
 */
export class UpdateVoicePreferencesDto {
  @IsOptional()
  @IsEnum(VoiceInputMode)
  inputMode?: VoiceInputMode;

  /** KeyboardEvent.code (e.g. "Space", "AltLeft"). Null/undefined clears. */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  pttKey?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2000)
  pttReleaseMs?: number;

  @IsOptional()
  @IsBoolean()
  noiseSuppression?: boolean;

  @IsOptional()
  @IsBoolean()
  echoCancellation?: boolean;

  @IsOptional()
  @IsBoolean()
  autoGainControl?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  micDeviceId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  cameraDeviceId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  outputDeviceId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  micVolume?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  outputVolume?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  shortcutMute?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  shortcutDeafen?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  shortcutDisconnect?: string | null;

  /** Phase 7: subtle join/leave/mute chimes. On by default. */
  @IsOptional()
  @IsBoolean()
  soundsEnabled?: boolean;
}
