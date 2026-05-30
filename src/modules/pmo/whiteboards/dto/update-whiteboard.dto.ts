import { Allow, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class UpdateWhiteboardDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  /// Excalidraw scene JSON ({ elements, appState, files }). Stored verbatim
  /// as the readable projection for previews + .mgm export; live edits go
  /// through Yjs.
  @IsOptional()
  @Allow()
  sceneSnapshot?: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  thumbnailUrl?: string | null;
}
