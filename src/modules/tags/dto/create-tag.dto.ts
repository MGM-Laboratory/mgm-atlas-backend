import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTagDto {
  @IsString()
  @MinLength(1)
  @MaxLength(48)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(48)
  category!: string;
}
