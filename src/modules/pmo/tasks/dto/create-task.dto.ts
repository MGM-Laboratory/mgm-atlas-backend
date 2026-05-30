import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { TaskPriority } from '@prisma/client';

export class CreateTaskDto {
  @IsString()
  @Length(1, 200)
  title!: string;

  /// Tiptap JSON description. Frontend serialises; we store verbatim,
  /// same convention as Project.description and ProjectNote.contentSnapshot.
  @IsOptional()
  description?: Record<string, unknown>;

  /// Status to file the new task under. When omitted, the service falls
  /// back to the TaskList's `isDefault` status (always "Backlog" out of
  /// the box).
  @IsOptional()
  @IsUUID('4')
  statusId?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  storyPoints?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  assigneeUserIds?: string[];
}
