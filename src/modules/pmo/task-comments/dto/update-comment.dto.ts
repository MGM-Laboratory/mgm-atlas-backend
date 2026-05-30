import { IsString, Length } from 'class-validator';

/// Edits replace the entire markdown body. v1 doesn't track edit history;
/// the row's `editedAt` flips and the activity feed gets a generic edit
/// event (folded into the COMMENT_ADDED kind for simplicity).
export class UpdateCommentDto {
  @IsString()
  @Length(1, 10_000)
  markdown!: string;
}
