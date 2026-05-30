import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

export class CreateNoteDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsUUID('4')
  parentNoteId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  @Matches(/^[a-z0-9-]+$/, { message: 'iconName must be a lowercase kebab-case Lucide key' })
  iconName?: string;
}
