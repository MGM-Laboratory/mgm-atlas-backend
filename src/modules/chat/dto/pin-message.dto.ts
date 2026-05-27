import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PinMessageDto {
  /** Optional context note (max 280 chars). */
  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}
