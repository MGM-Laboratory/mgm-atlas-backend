import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { ProjectAccessService } from '@/modules/projects/project-access.service';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * Project-scoped member search for @mention autocomplete in the chat
 * composer. Returns insiders only (project members + the project
 * owner) so a typo can't surface a user who has no access to the
 * channel — Atlas's notification ACL also enforces this on send.
 *
 * Lives under `/projects/:slugOrId/chat/members` to keep the chat
 * namespace cohesive and so the existing access guard can stay in
 * one place.
 */
@ApiBearerAuth()
@ApiTags('chat')
@Controller('projects/:slugOrId/chat/members')
export class ChatMembersController {
  constructor(
    private readonly access: ProjectAccessService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async search(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slugOrId') slugOrId: string,
    @Query('q') q?: string,
  ) {
    const { projectId, access } = await this.access.resolve(slugOrId, user);
    this.access.assertInsider(access);

    const term = (q ?? '').trim().toLowerCase();
    const members = await this.prisma.projectMember.findMany({
      where: {
        projectId,
        user: term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { email: { contains: term, mode: 'insensitive' } },
              ],
            }
          : undefined,
      },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      take: 20,
      select: {
        id: true,
        role: true,
        title: true,
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    return members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      title: m.title,
    }));
  }
}
