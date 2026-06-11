export default () => ({
  app: {
    env: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    baseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
    globalPrefix: process.env.API_GLOBAL_PREFIX ?? 'api',
    corsOrigins: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  database: {
    url: process.env.DATABASE_URL!,
  },
  keycloak: {
    baseUrl: process.env.KEYCLOAK_BASE_URL!,
    realm: process.env.KEYCLOAK_REALM!,
    clientId: process.env.KEYCLOAK_CLIENT_ID!,
    issuer: process.env.KEYCLOAK_ISSUER!,
    jwksUri: process.env.KEYCLOAK_JWKS_URI!,
    audience: process.env.KEYCLOAK_AUDIENCE ?? 'account',
  },
  auth: {
    // Verify Keycloak token signatures on POST /auth/login (JWKS + issuer +
    // audience). Emergency kill switch only: AUTH_VERIFY_TOKENS=false
    // restores the legacy trust-the-client behavior without a rebuild.
    verifyTokens: (process.env.AUTH_VERIFY_TOKENS ?? 'true').toLowerCase() !== 'false',
  },
  metrics: {
    // Bearer token guarding GET /api/v1/metrics. Empty (default) → endpoint
    // 404s (disabled). Set it + scrape over the tailnet from Prometheus.
    token: process.env.METRICS_TOKEN ?? '',
  },
  sentry: {
    // Error tracking (GlitchTip-compatible). Empty DSN → no-op (ships dark).
    dsn: process.env.SENTRY_DSN ?? '',
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),
  },
  bootstrap: {
    adminEmail: process.env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@labmgm.org',
    adminNotificationEmails: (process.env.ADMIN_NOTIFICATION_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  s3: {
    region: process.env.AWS_REGION!,
    bucket: process.env.AWS_S3_BUCKET!,
    publicBaseUrl: process.env.AWS_S3_PUBLIC_BASE_URL ?? '',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    presignTtl: parseInt(process.env.S3_UPLOAD_PRESIGN_TTL ?? '300', 10),
  },
  media: {
    maxImageBytes: parseInt(process.env.MEDIA_MAX_IMAGE_BYTES ?? '10485760', 10),
    maxVideoBytes: parseInt(process.env.MEDIA_MAX_VIDEO_BYTES ?? '104857600', 10),
    maxGalleryItems: parseInt(process.env.MEDIA_MAX_GALLERY_ITEMS ?? '10', 10),
    allowedImageMime: (process.env.MEDIA_ALLOWED_IMAGE_MIME ?? 'image/jpeg,image/png,image/webp,image/gif')
      .split(',')
      .map((s) => s.trim()),
    allowedVideoMime: (process.env.MEDIA_ALLOWED_VIDEO_MIME ?? 'video/mp4,video/webm')
      .split(',')
      .map((s) => s.trim()),
  },
  n8n: {
    baseUrl: process.env.N8N_BASE_URL!,
    webhookPath: process.env.N8N_WEBHOOK_PATH ?? '/webhook/atlas',
    secret: process.env.N8N_WEBHOOK_SECRET!,
  },
  mail: {
    host: process.env.MAIL_HOST ?? '',
    port: parseInt(process.env.MAIL_PORT ?? '587', 10),
    user: process.env.MAIL_USER ?? '',
    password: process.env.MAIL_PASSWORD ?? '',
    fromAddress: process.env.MAIL_FROM_ADDRESS ?? 'atlas@labmgm.org',
    fromName: process.env.MAIL_FROM_NAME ?? 'MGM Atlas',
  },
  jwt: {
    internalSecret: process.env.INTERNAL_JWT_SECRET!,
  },
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '120', 10),
  },
  redis: {
    // Empty when chat realtime is not yet provisioned. Code paths that
    // depend on Redis check for this and fall back to polling / no-op.
    url: process.env.REDIS_URL ?? '',
  },
  chat: {
    socketPath: process.env.CHAT_SOCKET_PATH ?? '/socket.io',
    linkPreviewCacheTtl: parseInt(process.env.CHAT_LINK_PREVIEW_CACHE_TTL ?? '86400', 10),
    tenorApiKey: process.env.TENOR_API_KEY ?? '',
    giphyApiKey: process.env.GIPHY_API_KEY ?? '',
    maxAttachmentsPerMessage: parseInt(process.env.CHAT_MAX_ATTACHMENTS_PER_MESSAGE ?? '10', 10),
    maxAttachmentBytes: parseInt(process.env.CHAT_MAX_ATTACHMENT_BYTES ?? '52428800', 10),
    editWindowHours: parseInt(process.env.CHAT_EDIT_WINDOW_HOURS ?? '24', 10),
  },
  pmo: {
    // Global kill switch. Off by default so the foundation ships dark.
    enabled: (process.env.PMO_ENABLED ?? 'false').toLowerCase() === 'true',
    maxTasksPerList: parseInt(process.env.PMO_MAX_TASKS_PER_LIST ?? '2000', 10),
    maxListsPerProject: parseInt(process.env.PMO_MAX_LISTS_PER_PROJECT ?? '50', 10),
    maxNotesPerProject: parseInt(process.env.PMO_MAX_NOTES_PER_PROJECT ?? '500', 10),
    maxWhiteboardsPerProject: parseInt(process.env.PMO_MAX_WHITEBOARDS_PER_PROJECT ?? '100', 10),
    maxTabsPerList: parseInt(process.env.PMO_MAX_TABS_PER_LIST ?? '20', 10),
    fileMaxBytes: parseInt(process.env.PMO_FILE_MAX_BYTES ?? '52428800', 10),
    /// Comma-separated MIME allowlist, or '*' for any.
    fileAllowedMime: (process.env.PMO_FILE_ALLOWED_MIME ?? '*')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  yjs: {
    // Public URL the frontend connects to. Empty = collab disabled, notes
    // and whiteboards stay in single-user-edit mode with a warning toast.
    publicWsUrl: process.env.YJS_PUBLIC_WS_URL ?? '',
    // Shared HMAC secret used by the y-websocket sidecar to call our
    // POST /internal/yjs/authorize and POST /internal/yjs/snapshot.
    internalAuthSecret: process.env.YJS_INTERNAL_AUTH_SECRET ?? '',
    // How long after the last edit before the sidecar pushes a snapshot.
    snapshotDebounceMs: parseInt(process.env.YJS_SNAPSHOT_DEBOUNCE_MS ?? '30000', 10),
  },
  voice: {
    // Global kill switch. Off by default so the foundation ships dark.
    enabled: (process.env.VOICE_ENABLED ?? 'false').toLowerCase() === 'true',
    // LiveKit signaling base URL (wss://atlas.labmgm.org/livekit in prod).
    // Empty = feature reports "unavailable" but backend boots unchanged.
    livekitUrl: process.env.LIVEKIT_URL ?? '',
    livekitApiKey: process.env.LIVEKIT_API_KEY ?? '',
    livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? '',
    // HMAC secret LiveKit signs its webhook deliveries with.
    livekitWebhookKey: process.env.LIVEKIT_WEBHOOK_KEY ?? '',
    // TTL for the LiveKit access tokens minted by the backend.
    jwtTtlSeconds: parseInt(process.env.VOICE_JWT_TTL_SECONDS ?? '14400', 10),
    // Default user-limit for newly-created channels (0 = unlimited).
    defaultUserLimit: parseInt(process.env.VOICE_DEFAULT_USER_LIMIT ?? '0', 10),
    // Phase 7: recording retention. 0 = keep forever.
    recordingRetentionDays: parseInt(process.env.VOICE_RECORDING_RETENTION_DAYS ?? '30', 10),
  },
  push: {
    // VAPID keys for Web Push. When any is empty, PushDispatchService
    // becomes a no-op (in-app notifications still emit via socket).
    // Generate with: npx web-push generate-vapid-keys
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? '',
    vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:dev@labmgm.org',
  },
});
