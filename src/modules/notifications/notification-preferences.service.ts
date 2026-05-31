import { Injectable } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * The exact set of patchable preference fields. Defined statically so
 * TS catches a missing toggle when a new NotificationType is added —
 * see the `prefField` map below; both have to be updated together.
 */
export type PreferenceFlags = {
  pushEnabled: boolean;
  contributionRequestEnabled: boolean;
  projectInvitedEnabled: boolean;
  projectRoleChangedEnabled: boolean;
  projectRemovedEnabled: boolean;
  chatMentionEnabled: boolean;
  taskAssignedEnabled: boolean;
  taskMentionedEnabled: boolean;
  taskDueSoonEnabled: boolean;
  taskOverdueEnabled: boolean;
  taskCommentReplyEnabled: boolean;
  taskStatusChangedEnabled: boolean;
  taskDependencyBlockedEnabled: boolean;
  noteMentionedEnabled: boolean;
  whiteboardMentionedEnabled: boolean;
  voiceParticipantJoinedEnabled: boolean;
  voiceMentionedEnabled: boolean;
};

/**
 * Map from NotificationType to the flag that gates it. Contribution
 * request lifecycle (3 types) share a single flag — users almost never
 * want to mute one outcome without the others.
 */
const prefField: Record<NotificationType, keyof PreferenceFlags> = {
  CONTRIBUTION_REQUEST_SUBMITTED: 'contributionRequestEnabled',
  CONTRIBUTION_REQUEST_APPROVED: 'contributionRequestEnabled',
  CONTRIBUTION_REQUEST_REJECTED: 'contributionRequestEnabled',
  PROJECT_INVITED: 'projectInvitedEnabled',
  PROJECT_ROLE_CHANGED: 'projectRoleChangedEnabled',
  PROJECT_REMOVED: 'projectRemovedEnabled',
  CHAT_MENTION: 'chatMentionEnabled',
  TASK_ASSIGNED: 'taskAssignedEnabled',
  TASK_MENTIONED: 'taskMentionedEnabled',
  TASK_DUE_SOON: 'taskDueSoonEnabled',
  TASK_OVERDUE: 'taskOverdueEnabled',
  TASK_COMMENT_REPLY: 'taskCommentReplyEnabled',
  TASK_STATUS_CHANGED: 'taskStatusChangedEnabled',
  TASK_DEPENDENCY_BLOCKED: 'taskDependencyBlockedEnabled',
  NOTE_MENTIONED: 'noteMentionedEnabled',
  WHITEBOARD_MENTIONED: 'whiteboardMentionedEnabled',
  VOICE_PARTICIPANT_JOINED: 'voiceParticipantJoinedEnabled',
  VOICE_MENTIONED: 'voiceMentionedEnabled',
};

@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get the user's preferences row, lazily creating a defaults row on
   * the first read. The `upsert` keeps this idempotent across racing
   * requests — `userId` is unique so a concurrent insert collapses to
   * an empty update.
   */
  async getOrCreate(userId: string) {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  /**
   * Truthy when the user has BOTH push enabled AND the per-type flag for
   * `type`. Defaults to true for users who've never set a preference
   * (no row in the table yet) so the rollout doesn't silently mute
   * existing users.
   */
  async isPushEnabledFor(userId: string, type: NotificationType): Promise<boolean> {
    const row = await this.prisma.notificationPreference.findUnique({
      where: { userId },
      select: { pushEnabled: true, [prefField[type]]: true } as Prisma.NotificationPreferenceSelect,
    });
    if (!row) return true;
    if (row.pushEnabled === false) return false;
    return (row as unknown as Record<string, boolean>)[prefField[type]] !== false;
  }

  /**
   * Patch any subset of the preference flags. Creates the row with
   * defaults first if it doesn't exist so the patch applies on top of
   * a known baseline.
   */
  async update(userId: string, patch: Partial<PreferenceFlags>) {
    await this.getOrCreate(userId);
    return this.prisma.notificationPreference.update({
      where: { userId },
      data: patch,
    });
  }
}
