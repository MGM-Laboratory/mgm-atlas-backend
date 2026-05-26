import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateStickerPackDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

export class UpdateStickerPackDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

export class PresignStickerDto {
  @IsString()
  @MaxLength(127)
  @Matches(/^image\//, { message: 'Stickers must be an image MIME type.' })
  contentType!: string;

  @IsInt()
  @Min(1)
  contentLength!: number;

  @IsString()
  @MaxLength(255)
  filename!: string;
}

export class RegisterStickerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  keywords?: string[];

  @IsString()
  s3Key!: string;

  @IsString()
  url!: string;

  @IsString()
  mime!: string;

  @IsOptional()
  @IsInt()
  width?: number;

  @IsOptional()
  @IsInt()
  height?: number;
}

export class ReorderStickerPacksDto {
  /** Each entry is a sticker id; their array index becomes the `position` field. */
  @IsArray()
  @IsString({ each: true })
  @Type(() => String)
  orderedIds!: string[];
}
