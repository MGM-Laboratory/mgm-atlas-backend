import { IsInt, IsString, MaxLength, Min } from 'class-validator';

export class PresignChatAttachmentDto {
  @IsString()
  @MaxLength(127)
  contentType!: string;

  @IsInt()
  @Min(1)
  contentLength!: number;

  @IsString()
  @MaxLength(255)
  filename!: string;
}
