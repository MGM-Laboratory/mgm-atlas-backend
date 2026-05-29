import { IsOptional, IsUUID } from 'class-validator';

export class ListFilesQueryDto {
  /// Folder whose immediate children to return. Omit for the project root.
  @IsOptional()
  @IsUUID('4')
  folderId?: string;
}
