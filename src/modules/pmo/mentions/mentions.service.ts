import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

export type MentionSuggestionKind = 'user' | 'task';

export interface MentionSuggestion {
  kind: MentionSuggestionKind;
  id: string;
  label: string;
  /// Optional subtitle ("Frontend developer", "FE-3 In Progress", etc.)
  /// rendered next to the label in the suggestion popover.
  subtitle?: string;
  /// User avatar URL or task icon name.
  avatarUrl?: string | null;
  iconName?: string | null;
  iconColor?: string | null;
}

/**
 * Backs the @-suggestion popover inside the task description editor and
 * comment composer. Currently surfaces project members (`kind=user`) and
 * tasks in the same project (`kind=task`). Notes / whiteboards become
 * mentionable in Phases 8 and 9.
 */
@Injectable()
export class MentionsService {
  constructor(private readonly prisma: PrismaService) {}

  async search(projectId: string, kind: MentionSuggestionKind, q: string): Promise<MentionSuggestion[]> {
    const query = q.trim();
    if (kind === 'user') return this.searchUsers(projectId, query);
    if (kind === 'task') return this.searchTasks(projectId, query);
    return [];
  }

  private async searchUsers(projectId: string, q: string): Promise<MentionSuggestion[]> {
    const members = await this.prisma.projectMember.findMany({
      where: {
        projectId,
        ...(q
          ? {
              OR: [
                { user: { name: { contains: q, mode: 'insensitive' } } },
                { user: { email: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      take: 12,
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
      orderBy: { user: { name: 'asc' } },
    });
    return members.map((m) => ({
      kind: 'user' as const,
      id: m.user.id,
      label: m.user.name,
      subtitle: m.title ?? m.role.toLowerCase().replace('_', ' '),
      avatarUrl: m.user.avatarUrl,
    }));
  }

  private async searchTasks(projectId: string, q: string): Promise<MentionSuggestion[]> {
    const tasks = await this.prisma.task.findMany({
      where: {
        projectId,
        deletedAt: null,
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: 'insensitive' } },
                { key: { contains: q.toUpperCase() } },
              ],
            }
          : {}),
      },
      take: 12,
      include: {
        status: true,
        taskList: { select: { iconName: true, iconColor: true } },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
    return tasks.map((t) => ({
      kind: 'task' as const,
      id: t.id,
      label: `${t.key}  ${t.title}`,
      subtitle: t.status.name,
      iconName: t.taskList.iconName,
      iconColor: t.taskList.iconColor,
    }));
  }
}
