import { TaskListTabKind, TaskStatusCategory } from '@prisma/client';

/**
 * Default statuses seeded into a new TaskList. Order matches the natural
 * left-to-right kanban flow; "Backlog" is `isDefault: true` so newly
 * created tasks land there until the PM customises the set.
 *
 * PMs can rename, recolor, reorder, or add statuses later via the
 * statuses bulk-update endpoint (Phase 2).
 */
export const DEFAULT_TASK_STATUSES: ReadonlyArray<{
  name: string;
  color: string;
  category: TaskStatusCategory;
  isDefault: boolean;
}> = [
  { name: 'Backlog', color: 'neutral', category: TaskStatusCategory.TODO, isDefault: true },
  { name: 'In Progress', color: 'blue', category: TaskStatusCategory.IN_PROGRESS, isDefault: false },
  { name: 'In Review', color: 'yellow', category: TaskStatusCategory.IN_PROGRESS, isDefault: false },
  { name: 'Done', color: 'green', category: TaskStatusCategory.DONE, isDefault: false },
];

/**
 * Default tab set seeded into a new TaskList. Order matches the
 * left-to-right navbar order. Each tab is visible by default; PMs can
 * hide individual tabs (but not delete built-ins) via the tabs reorder
 * endpoint. EMBED tabs come from a separate add-tab endpoint in Phase 10.
 */
export const DEFAULT_TASK_LIST_TABS: ReadonlyArray<{
  kind: TaskListTabKind;
  iconName: string;
}> = [
  { kind: TaskListTabKind.OVERVIEW, iconName: 'gauge' },
  { kind: TaskListTabKind.LIST, iconName: 'list-todo' },
  { kind: TaskListTabKind.KANBAN, iconName: 'kanban-square' },
  { kind: TaskListTabKind.GANTT, iconName: 'gantt-chart' },
  { kind: TaskListTabKind.TEAM, iconName: 'users-round' },
  { kind: TaskListTabKind.FILES, iconName: 'folder' },
  { kind: TaskListTabKind.NOTES, iconName: 'notebook-pen' },
  { kind: TaskListTabKind.WHITEBOARDS, iconName: 'pencil-ruler' },
];

/**
 * Derive a 2–6 char uppercase project key from a name. Used when the PM
 * doesn't supply one explicitly. Strips non-alpha, takes initials when
 * multi-word, falls back to the first 4 chars of a single word.
 */
export function deriveProjectKey(name: string): string {
  const cleaned = name.trim().toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ');
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'TASK';
  if (words.length === 1) {
    const w = words[0]!;
    return w.slice(0, Math.min(4, w.length)) || 'TASK';
  }
  return words
    .slice(0, 6)
    .map((w) => w[0]!)
    .join('')
    .slice(0, 6);
}
