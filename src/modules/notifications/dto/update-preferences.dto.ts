import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Every flag is optional — clients PATCH only the toggles they're
 * changing. Field names match the Prisma columns 1:1 so the controller
 * can pass the DTO straight into `prefs.update()`.
 */
export class UpdatePreferencesDto {
  @IsOptional() @IsBoolean() pushEnabled?: boolean;
  @IsOptional() @IsBoolean() contributionRequestEnabled?: boolean;
  @IsOptional() @IsBoolean() projectInvitedEnabled?: boolean;
  @IsOptional() @IsBoolean() projectRoleChangedEnabled?: boolean;
  @IsOptional() @IsBoolean() projectRemovedEnabled?: boolean;
  @IsOptional() @IsBoolean() chatMentionEnabled?: boolean;
  @IsOptional() @IsBoolean() taskAssignedEnabled?: boolean;
  @IsOptional() @IsBoolean() taskMentionedEnabled?: boolean;
  @IsOptional() @IsBoolean() taskDueSoonEnabled?: boolean;
  @IsOptional() @IsBoolean() taskOverdueEnabled?: boolean;
  @IsOptional() @IsBoolean() taskCommentReplyEnabled?: boolean;
  @IsOptional() @IsBoolean() taskStatusChangedEnabled?: boolean;
  @IsOptional() @IsBoolean() taskDependencyBlockedEnabled?: boolean;
  @IsOptional() @IsBoolean() noteMentionedEnabled?: boolean;
  @IsOptional() @IsBoolean() whiteboardMentionedEnabled?: boolean;
  @IsOptional() @IsBoolean() voiceParticipantJoinedEnabled?: boolean;
  @IsOptional() @IsBoolean() voiceMentionedEnabled?: boolean;
}
