import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Mirrors the browser's `PushSubscription.toJSON()` shape so the frontend
 * can post the result of `pushManager.subscribe()` verbatim.
 */
export class CreatePushSubscriptionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  endpoint!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  p256dh!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  auth!: string;

  /** Free-text user-agent so the settings UI can list a recognisable device name. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  userAgent?: string;
}
