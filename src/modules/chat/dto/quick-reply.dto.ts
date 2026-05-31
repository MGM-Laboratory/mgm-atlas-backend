import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for `POST /notifications/:id/quick-reply`. We deliberately don't
 * accept attachments / mentions / reply-to here — quick-reply is the
 * inline-reply-from-OS-banner case where the user has 1 plain-text
 * input and nothing else.
 */
export class QuickReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text!: string;
}
