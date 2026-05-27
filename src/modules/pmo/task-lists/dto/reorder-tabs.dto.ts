import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class TabOrderItemDto {
  @IsUUID('4')
  id!: string;

  @IsOptional()
  @IsBoolean()
  hidden?: boolean;
}

export class ReorderTabsDto {
  /// Ordered list of TaskListTab items. Position in the array becomes the
  /// new `order`; optional `hidden` toggles the tab off without deleting.
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TabOrderItemDto)
  tabs!: TabOrderItemDto[];
}
