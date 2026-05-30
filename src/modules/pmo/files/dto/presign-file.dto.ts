import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class PresignFileDto {
  @IsString()
  @MaxLength(255)
  filename!: string;

  @IsString()
  @MaxLength(127)
  contentType!: string;

  @IsInt()
  @Min(1)
  contentLength!: number;

  @IsOptional()
  @IsUUID('4')
  parentFolderId?: string;
}
