import { IsInt, IsString, Length, Min } from 'class-validator';

export class YjsSnapshotDto {
  @IsString()
  @Length(1, 200)
  docKey!: string;

  /// base64-encoded Yjs document update (opaque to the backend).
  @IsString()
  state!: string;

  @IsInt()
  @Min(0)
  size!: number;
}
