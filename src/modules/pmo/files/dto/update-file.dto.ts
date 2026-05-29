import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class UpdateFileDto {
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  /// A folder UUID to move into, or null to move to the project root.
  /// Omit the field entirely to leave the parent unchanged.
  @IsOptional()
  @IsUUID('4')
  parentFolderId?: string | null;
}
