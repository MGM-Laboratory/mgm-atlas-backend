import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReactMessageDto {
  /** Unicode emoji. Normalized client-side. */
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  emoji!: string;
}
