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
  ValidateIf,
} from 'class-validator';
import { TaskPriority } from '@prisma/client';

/**
 * Partial task patch. All fields optional. `description` is forwarded
 * verbatim to the DB (Tiptap JSON document). `null` on date fields
 * clears them; `undefined` leaves them alone — class-transformer
 * preserves the distinction.
 */
export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  description?: Record<string, unknown>;

  @IsOptional()
  @IsUUID('4')
  statusId?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(1000)
  storyPoints?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  startDate?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  assigneeUserIds?: string[];
}
