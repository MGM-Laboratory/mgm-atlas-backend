import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContributionRequestStatus } from '@prisma/client';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { ResolveRequestDto } from './dto/resolve-request.dto';
import { SubmitRequestDto } from './dto/submit-request.dto';

@Injectable()
export class ContributionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async submit(applicant: AuthenticatedUser, projectSlug: string, dto: SubmitRequestDto) {
    const project = await this.prisma.project.findFirst({
      where: { slug: projectSlug, deletedAt: null, archivedAt: null },
      include: { members: true },
    });
    if (!project) throw new NotFoundException('Project not found.');

    if (project.members.some((m) => m.userId === applicant.id)) {
      throw new ConflictException('You are already a member of this project.');
    }
    if (!project.collaborationRoles.includes(dto.role)) {
      throw new BadRequestException('That role is not currently being recruited.');
    }

    const existing = await this.prisma.contributionRequest.findFirst({
      where: { projectId: project.id, userId: applicant.id, status: 'PENDING' },
    });
    if (existing) {
      throw new ConflictException('You already have a pending request for this project.');
    }

    const request = await this.prisma.contributionRequest.create({
      data: {
        projectId: project.id,
        userId: applicant.id,
        role: dto.role,
        message: dto.message.trim(),
      },
      include: { user: true, project: { select: { id: true, slug: true, title: true } } },
    });

    // Notify all PMs in-app.
    const pms = project.members.filter((m) => m.role === 'PROJECT_MANAGER');
    await this.notifications.createMany(
      pms.map((m) => ({
        userId: m.userId,
        type: 'CONTRIBUTION_REQUEST_SUBMITTED',
        title: 'New contribution request',
        body: `${applicant.name} wants to join "${project.title}" as ${dto.role}.`,
        link: `/projects/${project.slug}/manage/requests`,
        metadata: { requestId: request.id, projectId: project.id, applicantId: applicant.id },
      })),
    );

    // Hand off to n8n for email orchestration (admins + PMs + applicant confirmation).
    await this.webhooks.dispatch('contribution.submitted', {
      requestId: request.id,
      project: { id: project.id, slug: project.slug, title: project.title },
      applicant: { id: applicant.id, name: applicant.name, email: applicant.email },
      role: dto.role,
      message: dto.message,
      adminEmails: this.config.get<string[]>('bootstrap.adminNotificationEmails') ?? [],
      projectManagerEmails: await this.pmEmails(project.id),
    });

    return request;
  }

  async withdraw(applicant: AuthenticatedUser, requestId: string) {
    const request = await this.prisma.contributionRequest.findUnique({
      where: { id: requestId },
      include: { project: { select: { id: true, slug: true, title: true } } },
    });
    if (!request) throw new NotFoundException('Request not found.');
    if (request.userId !== applicant.id) {
      throw new ForbiddenException('You can only withdraw your own requests.');
    }
    if (request.status !== 'PENDING') {
      throw new BadRequestException('Only pending requests can be withdrawn.');
    }

    const updated = await this.prisma.contributionRequest.update({
      where: { id: requestId },
      data: { status: 'WITHDRAWN', resolvedAt: new Date(), resolvedById: applicant.id },
    });

    await this.webhooks.dispatch('contribution.withdrawn', {
      requestId,
      project: request.project,
      applicantId: applicant.id,
    });
    return updated;
  }

  async listForProject(projectId: string, status?: ContributionRequestStatus) {
    return this.prisma.contributionRequest.findMany({
      where: { projectId, ...(status ? { status } : {}) },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async listMine(userId: string) {
    return this.prisma.contributionRequest.findMany({
      where: { userId },
      include: {
        project: {
          select: {
            id: true,
            slug: true,
            title: true,
            shortDescription: true,
            thumbnailUrl: true,
            thumbnailType: true,
          },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async approve(actor: AuthenticatedUser, requestId: string, dto: ResolveRequestDto) {
    return this.resolve(actor, requestId, 'APPROVED', dto.note);
  }

  async reject(actor: AuthenticatedUser, requestId: string, dto: ResolveRequestDto) {
    return this.resolve(actor, requestId, 'REJECTED', dto.note);
  }

  private async resolve(
    actor: AuthenticatedUser,
    requestId: string,
    outcome: 'APPROVED' | 'REJECTED',
    note: string | undefined,
  ) {
    const request = await this.prisma.contributionRequest.findUnique({
      where: { id: requestId },
      include: { project: true, user: true },
    });
    if (!request) throw new NotFoundException('Request not found.');
    if (request.status !== 'PENDING') {
      throw new BadRequestException('This request is no longer pending.');
    }

    if (!actor.isAdmin) {
      const isPm = await this.prisma.projectMember.findFirst({
        where: { projectId: request.projectId, userId: actor.id, role: 'PROJECT_MANAGER' },
      });
      if (!isPm) throw new ForbiddenException('Only Project Managers or Admins may resolve requests.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.contributionRequest.update({
        where: { id: requestId },
        data: {
          status: outcome,
          resolvedAt: new Date(),
          resolvedById: actor.id,
          resolutionNote: note,
        },
      });

      if (outcome === 'APPROVED') {
        await tx.projectMember.upsert({
          where: { projectId_userId: { projectId: request.projectId, userId: request.userId } },
          create: {
            projectId: request.projectId,
            userId: request.userId,
            role: 'CONTRIBUTOR',
            title: request.role,
          },
          update: { title: request.role },
        });
      }
      return u;
    });

    await this.notifications.create({
      userId: request.userId,
      type:
        outcome === 'APPROVED'
          ? 'CONTRIBUTION_REQUEST_APPROVED'
          : 'CONTRIBUTION_REQUEST_REJECTED',
      title: outcome === 'APPROVED' ? 'Welcome aboard' : 'Contribution request declined',
      body:
        outcome === 'APPROVED'
          ? `You're now a contributor on "${request.project.title}".`
          : `Your request to join "${request.project.title}" was declined.`,
      link: `/projects/${request.project.slug}`,
      metadata: { requestId, projectId: request.projectId, note },
    });

    await this.webhooks.dispatch(
      outcome === 'APPROVED' ? 'contribution.approved' : 'contribution.rejected',
      {
        requestId,
        project: {
          id: request.project.id,
          slug: request.project.slug,
          title: request.project.title,
        },
        applicant: {
          id: request.user.id,
          name: request.user.name,
          email: request.user.email,
        },
        role: request.role,
        note,
        resolvedBy: { id: actor.id, name: actor.name, email: actor.email },
      },
    );

    return updated;
  }

  private async pmEmails(projectId: string): Promise<string[]> {
    const pms = await this.prisma.projectMember.findMany({
      where: { projectId, role: 'PROJECT_MANAGER' },
      include: { user: { select: { email: true } } },
    });
    return pms.map((m) => m.user.email);
  }
}
