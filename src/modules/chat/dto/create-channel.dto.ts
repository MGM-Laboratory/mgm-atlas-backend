import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateChannelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[a-z0-9][a-z0-9-_]*$/i, {
    message: 'Channel name may only contain letters, numbers, hyphens, and underscores.',
  })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  topic?: string;
}
