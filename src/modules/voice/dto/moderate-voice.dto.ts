import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

/** Server-side mute / unmute a participant's microphone. */
export class ModerateMuteDto {
  /** The Atlas userId of the participant being targeted. */
  @IsUUID()
  participantUserId!: string;

  /** True (default) = force mute. False = unmute previously-muted. */
  @IsOptional()
  @IsBoolean()
  muted?: boolean;
}

/** Disconnect a participant from the channel. */
export class ModerateKickDto {
  @IsUUID()
  participantUserId!: string;

  /** Optional reason surfaced to the kicked user. */
  @IsOptional()
  @IsString()
  reason?: string;
}

/** Move a participant to a different voice channel within the same project. */
export class ModerateMoveDto {
  @IsUUID()
  participantUserId!: string;

  @IsUUID()
  targetChannelId!: string;
}
