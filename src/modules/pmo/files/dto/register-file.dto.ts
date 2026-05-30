import { IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, Min } from 'class-validator';

export class RegisterFileDto {
  @IsString()
  @Length(1, 255)
  name!: string;

  /// Object key returned by the presign call. Validated server-side to be
  /// under this project's files prefix; the public URL is derived from it.
  @IsString()
  @MaxLength(512)
  s3Key!: string;

  @IsString()
  @MaxLength(127)
  mime!: string;

  @IsInt()
  @Min(0)
  bytes!: number;

  @IsOptional()
  @IsUUID('4')
  parentFolderId?: string;
}
