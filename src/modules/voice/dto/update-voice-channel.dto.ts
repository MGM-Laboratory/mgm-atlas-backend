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
import { VoiceAudioQuality } from '@prisma/client';

export class UpdateVoiceChannelDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9 \-_]*$/)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  topic?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  userLimit?: number;

  @IsOptional()
  @IsEnum(VoiceAudioQuality)
  audioQuality?: VoiceAudioQuality;
}
