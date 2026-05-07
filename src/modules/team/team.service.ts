import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectRole } from '@prisma/client';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateMemberDto } from './dto/update-member.dto';

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhooksService,
  ) {}

  async invite(actor: AuthenticatedUser, projectId: string, dto: InviteUserDto) {
    const [project, target, existingMember, existingInvite] = await this.prisma.$transaction([
      this.prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, slug: true, title: true, deletedAt: true },
      }),
      this.prisma.user.findUnique({ where: { id: dto.userId } }),
      this.prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: dto.userId } },
      }),
      this.prisma.projectInvite.findFirst({
        where: { projectId, invitedUserId: dto.userId, status: 'PENDING' },
      }),
    ]);

    if (!project || project.deletedAt) throw new NotFoundException('Project not found.');
    if (!target) throw new NotFoundException('User not found.');
    if (existingMember) throw new ConflictException('User is already a member.');
    if (existingInvite) throw new ConflictException('User already has a pending invite.');

    const invite = await this.prisma.projectInvite.create({
      data: {
        projectId,
        invitedUserId: dto.userId,
        invitedById: actor.id,
        role: dto.role,
        title: dto.title,
      },
    });

    await this.notifications.create({
      userId: dto.userId,
      type: 'PROJECT_INVITED',
      title: 'You have been invited to a project',
      body: `${actor.name} invited you to join "${project.title}" as ${dto.role.toLowerCase().replace('_', ' ')}.`,
      link: `/projects/${project.slug}`,
      metadata: { inviteId: invite.id, projectId, role: dto.role },
    });

    await this.webhooks.dispatch('project.invited', {
      inviteId: invite.id,
      project: { id: project.id, slug: project.slug, title: project.title },
      invitedUser: { id: target.id, name: target.name, email: target.email },
      invitedBy: { id: actor.id, name: actor.name, email: actor.email },
      role: dto.role,
      title: dto.title,
    });

    return invite;
  }

  async acceptInvite(user: AuthenticatedUser, inviteId: string) {
    const invite = await this.prisma.projectInvite.findUnique({
      where: { id: inviteId },
      include: { project: { select: { id: true, slug: true, title: true } } },
    });
    if (!invite) throw new NotFoundException('Invite not found.');
    if (invite.invitedUserId !== user.id) throw new ForbiddenException();
    if (invite.status !== 'PENDING') throw new BadRequestException('Invite is no longer pending.');

    return this.prisma.$transaction(async (tx) => {
      const member = await tx.projectMember.upsert({
        where: { projectId_userId: { projectId: invite.projectId, userId: user.id } },
        create: {
          projectId: invite.projectId,
          userId: user.id,
          role: invite.role,
          title: invite.title,
        },
        update: { role: invite.role, title: invite.title },
      });
      await tx.projectInvite.update({
        where: { id: inviteId },
        data: { status: 'ACCEPTED' },
      });
      return member;
    });
  }

  async declineInvite(user: AuthenticatedUser, inviteId: string) {
    const invite = await this.prisma.projectInvite.findUnique({ where: { id: inviteId } });
    if (!invite) throw new NotFoundException('Invite not found.');
    if (invite.invitedUserId !== user.id) throw new ForbiddenException();
    if (invite.status !== 'PENDING') throw new BadRequestException('Invite is no longer pending.');
    return this.prisma.projectInvite.update({
      where: { id: inviteId },
      data: { status: 'DECLINED' },
    });
  }

  async revokeInvite(projectId: string, inviteId: string) {
    const invite = await this.prisma.projectInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.projectId !== projectId) throw new NotFoundException();
    if (invite.status !== 'PENDING') throw new BadRequestException('Invite is no longer pending.');
    return this.prisma.projectInvite.update({
      where: { id: inviteId },
      data: { status: 'REVOKED' },
    });
  }

  async updateMember(projectId: string, memberId: string, dto: UpdateMemberDto) {
    const member = await this.prisma.projectMember.findUnique({ where: { id: memberId } });
    if (!member || member.projectId !== projectId) throw new NotFoundException();
    return this.prisma.projectMember.update({
      where: { id: memberId },
      data: { role: dto.role ?? member.role, title: dto.title ?? member.title },
    });
  }

  async removeMember(actor: AuthenticatedUser, projectId: string, memberId: string) {
    const member = await this.prisma.projectMember.findUnique({
      where: { id: memberId },
      include: { project: { select: { ownerId: true, slug: true, title: true } }, user: true },
    });
    if (!member || member.projectId !== projectId) throw new NotFoundException();
    if (member.userId === member.project.ownerId) {
      throw new ForbiddenException('Cannot remove the project owner.');
    }
    if (member.role === 'PROJECT_MANAGER') {
      const pmCount = await this.prisma.projectMember.count({
        where: { projectId, role: 'PROJECT_MANAGER' },
      });
      if (pmCount <= 1) {
        throw new BadRequestException('A project must have at least one Project Manager.');
      }
    }
    await this.prisma.projectMember.delete({ where: { id: memberId } });

    await this.notifications.create({
      userId: member.userId,
      type: 'PROJECT_REMOVED',
      title: 'Removed from a project',
      body: `${actor.name} removed you from "${member.project.title}".`,
      link: '/dashboard',
      metadata: { projectId },
    });

    await this.webhooks.dispatch('project.member_removed', {
      project: { id: projectId, slug: member.project.slug, title: member.project.title },
      removed: { id: member.user.id, name: member.user.name, email: member.user.email },
      removedBy: { id: actor.id, name: actor.name, email: actor.email },
    });

    return { removed: true };
  }
}
