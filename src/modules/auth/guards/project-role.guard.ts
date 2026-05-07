import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProjectRole } from '@prisma/client';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { PrismaService } from '@/prisma/prisma.service';

export const PROJECT_ROLES_KEY = 'projectRoles';

/** Restrict a route to one or more per-project roles (admins always pass). */
export const RequireProjectRole = (...roles: ProjectRole[]) =>
  SetMetadata(PROJECT_ROLES_KEY, roles);

@Injectable()
export class ProjectRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<ProjectRole[]>(PROJECT_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthenticatedUser | undefined;
    if (!user) throw new ForbiddenException();

    if (user.isAdmin) return true;

    const projectId = await this.resolveProjectId(req);
    if (!projectId) throw new NotFoundException('Project not found.');

    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: user.id } },
      select: { role: true },
    });

    if (!membership || !required.includes(membership.role)) {
      throw new ForbiddenException(
        `Requires one of [${required.join(', ')}] on this project.`,
      );
    }
    return true;
  }

  /** Routes use either `:id` (uuid) or `:slug` to identify the project. */
  private async resolveProjectId(req: { params?: Record<string, string> }): Promise<string | null> {
    const params = req.params ?? {};
    if (params.id) return params.id;
    if (params.projectId) return params.projectId;
    if (params.slug) {
      const p = await this.prisma.project.findUnique({
        where: { slug: params.slug },
        select: { id: true },
      });
      return p?.id ?? null;
    }
    return null;
  }
}
