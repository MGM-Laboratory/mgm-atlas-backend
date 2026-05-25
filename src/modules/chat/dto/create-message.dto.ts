import { Type } from 'class-transformer';
import { ChatAttachmentKind } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class MessageAttachmentDto {
  @IsEnum(ChatAttachmentKind)
  kind!: ChatAttachmentKind;

  @IsUrl({ require_tld: false })
  url!: string;

  @IsString()
  @MinLength(1)
  s3Key!: string;

  @IsString()
  @MinLength(1)
  mime!: string;

  @IsInt()
  @Min(0)
  bytes!: number;

  @IsOptional()
  @IsInt()
  width?: number;

  @IsOptional()
  @IsInt()
  height?: number;

  @IsOptional()
  @IsNumber()
  durationSec?: number;

  @IsOptional()
  @IsUrl({ require_tld: false })
  posterUrl?: string;
}

export class CreateMessageDto {
  /**
   * GFM markdown source. Server stores it as-is; the renderer sanitizes
   * at read time. A message must have either text or at least one
   * attachment — empty is rejected by the service.
   */
  @IsString()
  @MaxLength(8000)
  markdown!: string;

  @IsOptional()
  @IsString()
  replyToId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => MessageAttachmentDto)
  attachments?: MessageAttachmentDto[];

  /** Echoed back in the response and on the realtime event so clients can reconcile optimistic sends. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientMessageId?: string;
}
