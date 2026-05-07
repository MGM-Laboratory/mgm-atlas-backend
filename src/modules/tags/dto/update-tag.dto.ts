import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateTagDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(48)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(48)
  category?: string;
}
