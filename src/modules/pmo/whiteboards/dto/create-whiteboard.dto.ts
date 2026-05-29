import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateWhiteboardDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
