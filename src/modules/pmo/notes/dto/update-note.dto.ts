import { Allow, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';

export class UpdateNoteDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  /// A note UUID to nest under, or null to move to the root. Omit to leave unchanged.
  @IsOptional()
  @IsUUID('4')
  parentNoteId?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  @Matches(/^[a-z0-9-]+$/, { message: 'iconName must be a lowercase kebab-case Lucide key' })
  iconName?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  /// BlockNote document JSON (an array of blocks). Stored verbatim as the
  /// readable projection for SSR/preview/search; live edits go via Yjs.
  @IsOptional()
  @Allow()
  contentSnapshot?: unknown;
}
