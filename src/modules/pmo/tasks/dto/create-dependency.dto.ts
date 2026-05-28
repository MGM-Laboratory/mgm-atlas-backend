import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { TaskDependencyKind } from '@prisma/client';

export class CreateDependencyDto {
  /// The task the `:taskId` route param waits for.
  /// "fromTaskId depends on toTaskId" in DB terms.
  @IsUUID('4')
  toTaskId!: string;

  @IsOptional()
  @IsEnum(TaskDependencyKind)
  kind?: TaskDependencyKind;
}
