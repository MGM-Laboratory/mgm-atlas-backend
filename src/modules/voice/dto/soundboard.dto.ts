import {
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Acceptable upload content types for soundboard clips. */
export const SOUNDBOARD_ALLOWED_MIME = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
] as const;

export type SoundboardMime = (typeof SOUNDBOARD_ALLOWED_MIME)[number];

/** Step 1 — admin asks for a presigned PUT URL. */
export class PresignSoundboardClipDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9 \-_]*$/, {
    message: 'Name may only contain letters, numbers, spaces, hyphens and underscores.',
  })
  name!: string;

  @IsIn(SOUNDBOARD_ALLOWED_MIME as unknown as string[])
  contentType!: SoundboardMime;

  /** Bytes — capped server-side to keep S3 + browsers happy. */
  @IsInt()
  @Min(1)
  @Max(10 * 1024 * 1024) // 10 MB hard cap; sane for short clips
  contentLength!: number;
}

/** Step 2 — admin registers the uploaded clip after the S3 PUT succeeds. */
export class RegisterSoundboardClipDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name!: string;

  /** Object key returned by the presign step. */
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  s3Key!: string;

  /** Duration of the audio, measured client-side after decode (ms). */
  @IsInt()
  @Min(1)
  @Max(30_000) // 30s max — soundboards are for short stings, not full tracks
  durationMs!: number;
}
