import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { ProjectAccess, ProjectAccessService } from '@/modules/projects/project-access.service';
import { PrismaService } from '@/prisma/prisma.service';

export interface ResolvedChannel {
  id: string;
  projectId: string | null;
  isArchived: boolean;
  isVoiceThread: boolean;
}

/**
 * Channel-keyed access resolution. Project channels delegate to
 * ProjectAccessService; workspace-global channels (projectId = null)
 * are readable/writable by every authenticated user, with admins as
 * their managers/moderators. Lets message-id and channel-id keyed
 * endpoints serve both kinds through one code path.
 */
@Injectable()
export class ChatChannelAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async resolveByChannelId(
    channelId: string,
    user: AuthenticatedUser,
  ): Promise<{ channel: ResolvedChannel; access: ProjectAccess }> {
    const channel = await this.prisma.chatChannel.findUnique({
      where: { id: channelId },
      select: { id: true, projectId: true, isArchived: true, isVoiceThread: true },
    });
    if (!channel) throw new NotFoundException('Channel not found.');
    return { channel, access: await this.accessFor(channel.projectId, user) };
  }

  async resolveByMessageId(
    messageId: string,
    user: AuthenticatedUser,
  ): Promise<{ channel: ResolvedChannel; access: ProjectAccess }> {
    const row = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: {
        channel: {
          select: { id: true, projectId: true, isArchived: true, isVoiceThread: true },
        },
      },
    });
    if (!row) throw new NotFoundException('Message not found.');
    return { channel: row.channel, access: await this.accessFor(row.channel.projectId, user) };
  }

  /** Access on a global channel: everyone is an insider, admins manage. */
  globalAccess(user: AuthenticatedUser): ProjectAccess {
    return user.isAdmin
      ? { level: 'admin', isInsider: true, isManager: true }
      : { level: 'contributor', isInsider: true, isManager: false };
  }

  assertInsider(access: ProjectAccess) {
    this.projectAccess.assertInsider(access);
  }

  assertManager(access: ProjectAccess) {
    this.projectAccess.assertManager(access);
  }

  private async accessFor(
    projectId: string | null,
    user: AuthenticatedUser,
  ): Promise<ProjectAccess> {
    if (projectId === null) return this.globalAccess(user);
    const { access } = await this.projectAccess.resolve(projectId, user);
    return access;
  }
}
