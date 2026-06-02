import { IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

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

  /// Last-active awareness user id supplied by the sidecar — used to
  /// attribute the resulting YDocSnapshotRevision row. Optional for
  /// rolling deploys: older sidecars don't send it and the field
  /// gracefully degrades to an anonymous revision.
  @IsOptional()
  @IsUUID()
  authorId?: string;
}
