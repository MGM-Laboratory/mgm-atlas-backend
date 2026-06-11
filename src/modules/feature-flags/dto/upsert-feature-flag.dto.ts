import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpsertFeatureFlagDto {
  /// Dotted, lowercase key, e.g. `ui.maintenance_banner`.
  @IsString()
  @Matches(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, {
    message: 'key must be lowercase dotted/snake (e.g. ui.maintenance_banner)',
  })
  @MaxLength(120)
  key!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;
}
