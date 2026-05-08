export default () => ({
  app: {
    env: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    baseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
    globalPrefix: process.env.API_GLOBAL_PREFIX ?? '',
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
});
