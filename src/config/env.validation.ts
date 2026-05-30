import { plainToInstance } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, Max, Min, validateSync } from 'class-validator';

enum AppEnv {
  Development = 'development',
  Test = 'test',
  Staging = 'staging',
  Production = 'production',
}

class EnvVars {
  @IsEnum(AppEnv)
  NODE_ENV: AppEnv = AppEnv.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @IsNotEmpty()
  APP_BASE_URL!: string;

  @IsOptional()
  @IsString()
  API_GLOBAL_PREFIX?: string;

  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsUrl({ require_tld: false })
  KEYCLOAK_BASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  KEYCLOAK_REALM!: string;

  @IsString()
  @IsNotEmpty()
  KEYCLOAK_CLIENT_ID!: string;

  @IsUrl({ require_tld: false })
  KEYCLOAK_ISSUER!: string;

  @IsUrl({ require_tld: false })
  KEYCLOAK_JWKS_URI!: string;

  @IsOptional()
  @IsString()
  KEYCLOAK_AUDIENCE?: string;

  @IsString()
  @IsNotEmpty()
  BOOTSTRAP_ADMIN_EMAIL!: string;

  @IsOptional()
  @IsString()
  ADMIN_NOTIFICATION_EMAILS?: string;

  @IsString()
  @IsNotEmpty()
  AWS_REGION!: string;

  @IsString()
  @IsNotEmpty()
  AWS_S3_BUCKET!: string;

  @IsOptional()
  @IsString()
  AWS_S3_PUBLIC_BASE_URL?: string;

  @IsString()
  @IsNotEmpty()
  AWS_ACCESS_KEY_ID!: string;

  @IsString()
  @IsNotEmpty()
  AWS_SECRET_ACCESS_KEY!: string;

  @IsOptional()
  @IsInt()
  S3_UPLOAD_PRESIGN_TTL?: number;

  @IsUrl({ require_tld: false })
  N8N_BASE_URL!: string;

  @IsOptional()
  @IsString()
  N8N_WEBHOOK_PATH?: string;

  @IsString()
  @IsNotEmpty()
  N8N_WEBHOOK_SECRET!: string;

  @IsOptional()
  @IsString()
  MAIL_HOST?: string;

  @IsOptional()
  @IsInt()
  MAIL_PORT?: number;

  @IsOptional()
  @IsString()
  MAIL_USER?: string;

  @IsOptional()
  @IsString()
  MAIL_PASSWORD?: string;

  @IsOptional()
  @IsString()
  MAIL_FROM_ADDRESS?: string;

  @IsOptional()
  @IsString()
  MAIL_FROM_NAME?: string;

  @IsString()
  @IsNotEmpty()
  INTERNAL_JWT_SECRET!: string;

  // ─── Chat (all optional; when REDIS_URL is unset, sockets stay dormant
  //     and chat falls back to REST polling so prod boots unchanged) ───
  @IsOptional()
  @IsString()
  REDIS_URL?: string;

  @IsOptional()
  @IsString()
  CHAT_SOCKET_PATH?: string;

  @IsOptional()
  @IsInt()
  CHAT_LINK_PREVIEW_CACHE_TTL?: number;

  @IsOptional()
  @IsString()
  TENOR_API_KEY?: string;

  @IsOptional()
  @IsString()
  GIPHY_API_KEY?: string;

  @IsOptional()
  @IsInt()
  CHAT_MAX_ATTACHMENTS_PER_MESSAGE?: number;

  @IsOptional()
  @IsInt()
  CHAT_MAX_ATTACHMENT_BYTES?: number;

  @IsOptional()
  @IsInt()
  CHAT_EDIT_WINDOW_HOURS?: number;

  // ─── PMO (all optional; PMO_ENABLED=false by default keeps the whole
  //     module dark so prod boots unchanged) ─────────────────────────
  @IsOptional()
  @IsString()
  PMO_ENABLED?: string;

  @IsOptional()
  @IsInt()
  PMO_MAX_TASKS_PER_LIST?: number;

  @IsOptional()
  @IsInt()
  PMO_MAX_LISTS_PER_PROJECT?: number;

  @IsOptional()
  @IsInt()
  PMO_MAX_NOTES_PER_PROJECT?: number;

  @IsOptional()
  @IsInt()
  PMO_MAX_WHITEBOARDS_PER_PROJECT?: number;

  @IsOptional()
  @IsInt()
  PMO_MAX_TABS_PER_LIST?: number;

  @IsOptional()
  @IsInt()
  PMO_FILE_MAX_BYTES?: number;

  @IsOptional()
  @IsString()
  PMO_FILE_ALLOWED_MIME?: string;

  // ─── Yjs (notes + whiteboards realtime collab) ────────────────────
  // Frontend connects to YJS_PUBLIC_WS_URL; backend authorizes joins
  // via YJS_INTERNAL_AUTH_SECRET (HMAC on the auth callback).
  @IsOptional()
  @IsString()
  YJS_PUBLIC_WS_URL?: string;

  @IsOptional()
  @IsString()
  YJS_INTERNAL_AUTH_SECRET?: string;

  @IsOptional()
  @IsInt()
  YJS_SNAPSHOT_DEBOUNCE_MS?: number;

  // ─── Voice chat (LiveKit; all optional so VOICE_ENABLED=false ships dark) ──
  // VOICE_ENABLED=false → every /voice/* route 404s and no LiveKit
  // connection is attempted. The other vars are only consulted when
  // VOICE_ENABLED=true; an empty LIVEKIT_URL causes the feature to
  // report "unavailable" rather than crashing.
  @IsOptional()
  @IsString()
  VOICE_ENABLED?: string;

  @IsOptional()
  @IsString()
  LIVEKIT_URL?: string;

  @IsOptional()
  @IsString()
  LIVEKIT_API_KEY?: string;

  @IsOptional()
  @IsString()
  LIVEKIT_API_SECRET?: string;

  /// HMAC secret LiveKit signs its webhook deliveries with.
  @IsOptional()
  @IsString()
  LIVEKIT_WEBHOOK_KEY?: string;

  @IsOptional()
  @IsInt()
  VOICE_JWT_TTL_SECONDS?: number;

  @IsOptional()
  @IsInt()
  VOICE_DEFAULT_USER_LIMIT?: number;

  /// Phase 7 (recording). Default 30d retention; 0 = keep forever.
  @IsOptional()
  @IsInt()
  VOICE_RECORDING_RETENTION_DAYS?: number;
}

export function validateEnv(raw: Record<string, unknown>) {
  const validated = plainToInstance(EnvVars, raw, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const formatted = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${formatted}`);
  }
  return validated;
}
