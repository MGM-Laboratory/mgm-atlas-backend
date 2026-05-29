import { IsString, Length, MaxLength } from 'class-validator';

export class YjsAuthorizeDto {
  /// Document scope, e.g. "note:<uuid>" or "whiteboard:<uuid>".
  @IsString()
  @Length(1, 200)
  docKey!: string;

  /// The yToken minted by GET /projects/:slug/notes/:noteId/yjs-token.
  @IsString()
  @MaxLength(4096)
  token!: string;
}
