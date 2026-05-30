import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

const ICON_COLORS = ['blue', 'yellow', 'red', 'green', 'neutral'] as const;
export type TaskListIconColor = (typeof ICON_COLORS)[number];

export class CreateTaskListDto {
  @IsString()
  @Length(1, 80)
  name!: string;

  /// Lucide icon key, e.g. "list-todo", "code-2", "palette". Validated as a
  /// kebab-case slug to avoid arbitrary strings reaching the renderer.
  @IsOptional()
  @IsString()
  @Length(1, 40)
  @Matches(/^[a-z0-9-]+$/, { message: 'iconName must be a lowercase kebab-case Lucide key' })
  iconName?: string;

  @IsOptional()
  @IsIn(ICON_COLORS)
  iconColor?: TaskListIconColor;

  /// Uppercase 2–6 character code used for Task.key (e.g. "FE"). Optional;
  /// service derives one from project slug + list name when omitted.
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9]{1,5}$/, { message: 'projectKey must be 2–6 uppercase letters/digits' })
  projectKey?: string;

  @IsOptional()
  @IsBoolean()
  contributorsCanCreateTasks?: boolean;
}
