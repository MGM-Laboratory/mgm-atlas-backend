import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { MediaType } from '@prisma/client';

export class RegisterMediaDto {
  @IsString()
  url!: string;

  @IsEnum(MediaType)
  type!: MediaType;

  /** 0 = thumbnail; 1+ = gallery position. */
  @IsInt()
  @Min(0)
  order!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;
}
