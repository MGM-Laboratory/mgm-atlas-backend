import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateFolderDto {
  @IsString()
  @Length(1, 255)
  name!: string;

  @IsOptional()
  @IsUUID('4')
  parentFolderId?: string;
}
