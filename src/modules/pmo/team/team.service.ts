import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectRole } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

export interface TeamMember {
  id: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    bio: string | null;
  };
  role: ProjectRole;
  /// Free-form collaboration role title (e.g. "Frontend Engineer").
  title: string | null;
  joinedAt: Date;
  /// Project-wide count of non-deleted, non-archived tasks assigned to this user.
  taskCount: number;
  /// True if this member is the project owner (their card gets an "Owner" badge).
  isOwner: boolean;
}

export interface TeamPayload {
  managers: TeamMember[];
  contributors: TeamMember[];
}

@Injectable()
export class TeamService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Project-wide team for the Team tab. Backend groups by role and sorts
   * by name within each group; PM cards land at the top of the view.
   *
   * Task counts are project-wide (across all task lists) because team
   * is a project-level concept; the same person appears with the same
   * count regardless of which list's Team tab the user is on.
   */
  async get(projectId: string): Promise<TeamPayload> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { ownerId: true },
    });
    if (!project) throw new NotFoundException('Project not found.');

    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: {
          select: { id: true, name: true, email: true, avatarUrl: true, bio: true },
        },
      },
      orderBy: { user: { name: 'asc' } },
    });

    // One aggregate query for everyone's task count, indexed by userId.
    const counts = await this.prisma.taskAssignee.groupBy({
      by: ['userId'],
      where: {
        userId: { in: members.map((m) => m.userId) },
        task: { projectId, deletedAt: null, archivedAt: null },
      },
      _count: { taskId: true },
    });
    const countByUser = new Map(counts.map((c) => [c.userId, c._count.taskId]));

    const shape = (m: (typeof members)[number]): TeamMember => ({
      id: m.id,
      user: m.user,
      role: m.role,
      title: m.title,
      joinedAt: m.joinedAt,
      taskCount: countByUser.get(m.userId) ?? 0,
      isOwner: m.userId === project.ownerId,
    });

    return {
      managers: members.filter((m) => m.role === ProjectRole.PROJECT_MANAGER).map(shape),
      contributors: members.filter((m) => m.role === ProjectRole.CONTRIBUTOR).map(shape),
    };
  }
}
