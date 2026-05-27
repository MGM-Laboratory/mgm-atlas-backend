import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListCommentsQueryDto {
  /// 1-indexed page number. Pagination matters for tasks with long
  /// discussions; the modal renders newest first.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => Number(value))
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => Number(value))
  pageSize?: number;
}
