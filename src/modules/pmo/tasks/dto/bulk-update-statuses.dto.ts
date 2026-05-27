import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';
import { TaskStatusCategory } from '@prisma/client';

const STATUS_COLORS = ['blue', 'yellow', 'red', 'green', 'neutral'] as const;
type StatusColor = (typeof STATUS_COLORS)[number];

/**
 * One status entry inside the bulk-update payload. Existing statuses keep
 * their `id`; new statuses send `id = undefined` and the service mints
 * one. The order of items in the array is the new column order.
 */
export class StatusEntryDto {
  /// Omit `id` to create a new status; include it to update an existing one.
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @IsString()
  @Length(1, 40)
  name!: string;

  @IsOptional()
  @IsIn(STATUS_COLORS)
  color?: StatusColor;

  @IsOptional()
  @IsEnum(TaskStatusCategory)
  category?: TaskStatusCategory;

  /// Exactly one entry should set this to true. The service enforces it
  /// (defaults to the first entry if no flag is set).
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class BulkUpdateStatusesDto {
  /// Full desired set of statuses, in display order. Statuses not present
  /// here will be deleted (after their tasks are moved to `moveTasksTo`).
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => StatusEntryDto)
  statuses!: StatusEntryDto[];

  /// When deleting statuses that still have tasks, every affected task is
  /// re-pointed at this status. Required when at least one deletion is
  /// destructive; ignored otherwise.
  @IsOptional()
  @IsUUID('4')
  moveTasksTo?: string;
}
