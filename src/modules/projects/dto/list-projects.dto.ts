import { Transform, Type } from 'class-transformer';
import { ProjectPhase, ProjectVisibility } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const splitCsv = ({ value }: { value: unknown }) => {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return value;
};

export class ListProjectsDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsEnum(ProjectPhase, { each: true })
  @IsArray()
  @Transform(splitCsv)
  phase?: ProjectPhase[];

  @IsOptional()
  @IsEnum(ProjectVisibility)
  visibility?: ProjectVisibility;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(splitCsv)
  tagIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  recruitingFor?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  archived?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  bookmarkedOnly?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  pageSize = 24;

  @IsOptional()
  @IsString()
  sort?: 'newest' | 'oldest' | 'recently-updated' | 'title';
}
