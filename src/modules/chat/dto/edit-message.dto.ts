import { IsString, MaxLength } from 'class-validator';

export class EditMessageDto {
  @IsString()
  @MaxLength(8000)
  markdown!: string;
}
