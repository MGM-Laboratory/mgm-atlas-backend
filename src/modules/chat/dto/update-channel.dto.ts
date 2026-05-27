import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[a-z0-9][a-z0-9-_]*$/i)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  topic?: string;
}
