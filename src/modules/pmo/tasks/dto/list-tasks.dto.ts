import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class ListTasksQueryDto {
  /// Filter to a single status column.
  @IsOptional()
  @IsUUID('4')
  statusId?: string;

  /// Filter to tasks assigned to this user.
  @IsOptional()
  @IsUUID('4')
  assigneeId?: string;

  /// Free-text search on the title (case-insensitive). Skips description
  /// for now — full-text on Tiptap JSON is its own thing.
  @IsOptional()
  @IsString()
  @Length(1, 200)
  q?: string;

  /// "true" to include archived tasks in the response. Default excludes
  /// them so the list view stays clean.
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  includeArchived?: boolean;
}
