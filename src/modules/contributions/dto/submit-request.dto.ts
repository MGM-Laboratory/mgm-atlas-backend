import { IsString, MaxLength, MinLength } from 'class-validator';

export class SubmitRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  role!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  message!: string;
}
