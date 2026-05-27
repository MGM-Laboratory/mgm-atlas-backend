import { PartialType, PickType } from '@nestjs/swagger';
import { CreateTaskListDto } from './create-task-list.dto';

/**
 * Patch shape for a TaskList. All fields optional. `projectKey` and
 * `contributorsCanCreateTasks` reuse the validators on CreateTaskListDto.
 * `order` is reordered via a separate endpoint, not this one.
 */
export class UpdateTaskListDto extends PartialType(
  PickType(CreateTaskListDto, ['name', 'iconName', 'iconColor', 'projectKey', 'contributorsCanCreateTasks'] as const),
) {}
