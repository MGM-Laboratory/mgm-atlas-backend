import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class ReorderTaskListsDto {
  /// Ordered list of TaskList ids. The new `order` for each list is its
  /// position in this array. Missing ids keep their current order.
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  listIds!: string[];
}
