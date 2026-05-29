import { IsIn, IsOptional, IsString, IsUrl, Length, Matches, MaxLength } from 'class-validator';

const EMBED_PRESETS = [
  'figma',
  'gdocs',
  'gsheets',
  'gslides',
  'canva',
  'loom',
  'youtube',
  'miro',
  'custom',
] as const;

export class CreateEmbedTabDto {
  @IsString()
  @Length(1, 80)
  label!: string;

  /// Must be https — enforced server-side so we never frame an http origin.
  @IsString()
  @MaxLength(2048)
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  url!: string;

  @IsOptional()
  @IsIn(EMBED_PRESETS)
  embedPreset?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  @Matches(/^[a-z0-9-]+$/, { message: 'iconName must be a lowercase kebab-case Lucide key' })
  iconName?: string;
}
