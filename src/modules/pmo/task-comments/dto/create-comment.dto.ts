import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateCommentDto {
  /// GFM markdown source. Same convention as ChatMessage.markdown.
  /// Mentions use the `@[name](userId)` shape; the service extracts and
  /// notifies the referenced users on save.
  @IsString()
  @Length(1, 10_000)
  markdown!: string;

  /// When set, this comment is a reply to another comment on the same
  /// task. Layout in v1 is single-level indentation (no nested threads).
  @IsOptional()
  @IsUUID('4')
  replyToId?: string;
}
