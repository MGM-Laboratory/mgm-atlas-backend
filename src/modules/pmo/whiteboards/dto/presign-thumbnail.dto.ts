import { IsInt, IsString, MaxLength, Min } from 'class-validator';

export class PresignThumbnailDto {
  @IsString()
  @MaxLength(127)
  contentType!: string;

  @IsInt()
  @Min(1)
  contentLength!: number;
}
