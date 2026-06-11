// Sentry (GlitchTip-compatible) initialization. MUST be imported before any
// other module in main.ts so instrumentation can patch libraries first.
// No-op when SENTRY_DSN is empty, so the app ships dark until the monitoring
// VM + DSN exist (Phase 6).
import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN ?? '';

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.GIT_SHA || undefined,
    // Tracing off by default (0); raise via env once the backend is observed.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),
    sendDefaultPii: false,
  });
}
