import { Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * Powers the navbar "chat" shortcut and the global /chat page on the
 * frontend. Returns the projects this user has chat access to, with
 * each project's channels and unread counts.
 *
 * Unread is computed cheaply: count messages newer than the channel
 * member's lastReadAt; if there's no lastReadAt yet we treat every
 * message in the channel as unread (cap at 99).
 */
@Injectable()
export class ChatOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async listMyProjects(user: AuthenticatedUser) {
    const projects = await this.prisma.project.findMany({
      where: {
        deletedAt: null,
        ...(user.isAdmin ? {} : { members: { some: { userId: user.id } } }),
      },
      select: {
        id: true,
        slug: true,
        title: true,
        thumbnailUrl: true,
        updatedAt: true,
        chatChannels: {
          where: { isArchived: false },
          orderBy: [{ isGeneral: 'desc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            name: true,
            slug: true,
            isGeneral: true,
            updatedAt: true,
            members: {
              where: { userId: user.id },
              select: { lastReadAt: true },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const projectsWithUnread = await Promise.all(
      projects
        .filter((p) => p.chatChannels.length > 0)
        .map(async (p) => {
          const channels = await Promise.all(
            p.chatChannels.map(async (c) => {
              const lastReadAt = c.members[0]?.lastReadAt ?? null;
              const unread = await this.prisma.chatMessage.count({
                where: {
                  channelId: c.id,
                  deletedAt: null,
                  authorId: { not: user.id },
                  ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
                },
              });
              return {
                id: c.id,
                name: c.name,
                slug: c.slug,
                isGeneral: c.isGeneral,
                unread: Math.min(unread, 99),
                updatedAt: c.updatedAt,
              };
            }),
          );
          const totalUnread = channels.reduce((sum, ch) => sum + ch.unread, 0);
          return {
            id: p.id,
            slug: p.slug,
            title: p.title,
            thumbnailUrl: p.thumbnailUrl,
            updatedAt: p.updatedAt,
            channels,
            unread: totalUnread,
          };
        }),
    );

    return { projects: projectsWithUnread };
  }
}
