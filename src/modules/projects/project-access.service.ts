import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ProjectRole } from '@prisma/client';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { PrismaService } from '@/prisma/prisma.service';

export type AccessLevel = 'admin' | 'manager' | 'contributor' | 'viewer' | 'guest';

export interface ProjectAccess {
  level: AccessLevel;
  isInsider: boolean;
  isManager: boolean;
  membership?: { role: ProjectRole };
}

@Injectable()
export class ProjectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the access level a user has on a project. Throws 404 if the
   * project does not exist (or has been hard-deleted) and 403 if the user
   * lacks even baseline visibility on a private project.
   */
  async resolve(
    slugOrId: string,
    user: AuthenticatedUser,
  ): Promise<{ projectId: string; access: ProjectAccess }> {
    const project = await this.prisma.project.findFirst({
      where: {
        deletedAt: null,
        OR: [{ id: slugOrId }, { slug: slugOrId }],
      },
      select: {
        id: true,
        visibility: true,
        ownerId: true,
        members: { where: { userId: user.id }, select: { role: true } },
      },
    });
    if (!project) throw new NotFoundException('Project not found.');

    const membership = project.members[0];

    if (user.isAdmin) {
      return {
        projectId: project.id,
        access: { level: 'admin', isInsider: true, isManager: true, membership },
      };
    }

    if (membership) {
      const isManager = membership.role === 'PROJECT_MANAGER';
      return {
        projectId: project.id,
        access: {
          level: isManager ? 'manager' : 'contributor',
          isInsider: true,
          isManager,
          membership,
        },
      };
    }

    if (project.visibility === 'PRIVATE') {
      throw new ForbiddenException('This project is private.');
    }

    return {
      projectId: project.id,
      access: { level: 'viewer', isInsider: false, isManager: false },
    };
  }

  /** Throws ForbiddenException if the user is not a manager (admins always pass). */
  assertManager(access: ProjectAccess) {
    if (!access.isManager) throw new ForbiddenException('Project Manager role required.');
  }

  /** Throws ForbiddenException if the user has no membership on the project (admins always pass). */
  assertInsider(access: ProjectAccess) {
    if (!access.isInsider) throw new ForbiddenException('Project membership required.');
  }

  /// After assertInsider() the access level is guaranteed to be one
  /// of these three. Helper for services that need to narrow on it
  /// (e.g. tasks.service.ts already takes this exact type).
  asInsiderKind(access: ProjectAccess): 'admin' | 'manager' | 'contributor' {
    return access.level as 'admin' | 'manager' | 'contributor';
  }
}
