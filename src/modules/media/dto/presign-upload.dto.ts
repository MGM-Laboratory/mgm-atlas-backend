import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PresignUploadDto {
  @IsString()
  contentType!: string;

  @IsInt()
  @Min(1)
  @Max(200 * 1024 * 1024)
  contentLength!: number;

  /** Whether this upload will become the project thumbnail. Affects size cap. */
  @IsOptional()
  @IsIn(['thumbnail', 'gallery'])
  purpose?: 'thumbnail' | 'gallery';
}
