import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ProjectPhase, ProjectVisibility } from '@prisma/client';

export class InternalLinksDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  pmTool?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  repository?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  staging?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  designs?: string;
}

export class CreateProjectDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(280)
  shortDescription!: string;

  /** Tiptap-style rich-text JSON document. Stored as-is. */
  @IsObject()
  description!: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(40)
  techStack?: string[];

  @IsEnum(ProjectPhase)
  phase!: ProjectPhase;

  @IsEnum(ProjectVisibility)
  visibility!: ProjectVisibility;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  collaborationRoles?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(40)
  tagIds?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => InternalLinksDto)
  internalLinks?: InternalLinksDto;
}
