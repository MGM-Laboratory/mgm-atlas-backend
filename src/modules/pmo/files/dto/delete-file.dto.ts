import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class DeleteFileQueryDto {
  /// "1" / "true" to recursively delete a non-empty folder and its contents.
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  force?: boolean;
}
