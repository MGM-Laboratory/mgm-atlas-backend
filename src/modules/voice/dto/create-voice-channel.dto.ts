import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { VoiceAudioQuality, VoiceChannelKind } from '@prisma/client';

/**
 * DTO for creating a voice channel. Used by both per-project and
 * workspace-lobby controllers — projectId is resolved from the route,
 * not from the body.
 */
export class CreateVoiceChannelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9 \-_]*$/, {
    message:
      'Channel name may only contain letters, numbers, spaces, hyphens, and underscores.',
  })
  name!: string;

  /** Discord-style status / topic line shown beside the channel. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  topic?: string;

  /** Max simultaneous occupants. 0 (or omitted) = unlimited. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  userLimit?: number;

  @IsOptional()
  @IsEnum(VoiceAudioQuality)
  audioQuality?: VoiceAudioQuality;

  /** Phase 8: STANDARD (default) or STAGE (speaker/audience model). */
  @IsOptional()
  @IsEnum(VoiceChannelKind)
  kind?: VoiceChannelKind;
}
