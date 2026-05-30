import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin wrapper around livekit-server-sdk. Acts as the single point where
 * the rest of the backend interacts with LiveKit (JWT minting, room
 * moderation, webhook verification). Designed to fail-soft: when
 * VOICE_ENABLED=false OR any of the three LiveKit creds is missing, the
 * service reports `available=false` and every method returns null/false
 * rather than throwing. That guarantees the backend boots even before
 * LiveKit is provisioned, matching the chat/PMO graceful-degrade pattern.
 *
 * The actual `livekit-server-sdk` import is deferred until the first call
 * that needs it. This means a backend image that hasn't yet had `pnpm
 * install` run with the new dep on it will still start as long as
 * VOICE_ENABLED stays false — the require() never fires.
 */
@Injectable()
export class LivekitService {
  private readonly logger = new Logger(LivekitService.name);
  private readonly enabled: boolean;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly url: string;
  private readonly jwtTtlSec: number;
  private readonly webhookKey: string;

  // SDK types are intentionally `any` in Phase 0: we want this file to
  // type-check before livekit-server-sdk is installed in any environment
  // (lockfile regen is gated on the user — see PMO_HANDOVER deploy notes).
  // Phase 1, when the SDK is universally installed and we add the gateway
  // + join controller, will tighten these to the real types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sdk: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private roomService: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private webhookReceiver: any = null;

  constructor(config: ConfigService) {
    this.enabled = config.get<boolean>('voice.enabled', false);
    this.url = config.get<string>('voice.livekitUrl', '');
    this.apiKey = config.get<string>('voice.livekitApiKey', '');
    this.apiSecret = config.get<string>('voice.livekitApiSecret', '');
    this.webhookKey = config.get<string>('voice.livekitWebhookKey', '');
    this.jwtTtlSec = config.get<number>('voice.jwtTtlSeconds', 14400);
  }

  /** True when the feature flag is on AND all three LiveKit creds are populated. */
  isAvailable(): boolean {
    return this.enabled && !!this.url && !!this.apiKey && !!this.apiSecret;
  }

  /**
   * The public WS URL clients connect to. Returned to the frontend
   * alongside the minted JWT on a join. Empty string when unavailable.
   */
  getPublicUrl(): string {
    return this.isAvailable() ? this.url : '';
  }

  /**
   * Mint a room-scoped LiveKit JWT for a user. Caller is responsible for
   * having already passed the per-feature access check (ProjectAccessService
   * or lobby). Returns null when LiveKit is unavailable so the controller
   * can return a clean 503.
   */
  async mintAccessToken(args: {
    roomName: string;
    identity: string;
    name: string;
    metadata?: Record<string, unknown>;
    canPublish?: boolean;
    canSubscribe?: boolean;
    canPublishSources?: ('camera' | 'microphone' | 'screen_share' | 'screen_share_audio')[];
    ttlSec?: number;
  }): Promise<string | null> {
    if (!this.isAvailable()) return null;
    const sdk = await this.loadSdk();
    if (!sdk) return null;
    const { AccessToken } = sdk;
    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity: args.identity,
      name: args.name,
      metadata: args.metadata ? JSON.stringify(args.metadata) : undefined,
      ttl: args.ttlSec ?? this.jwtTtlSec,
    });
    at.addGrant({
      roomJoin: true,
      room: args.roomName,
      canPublish: args.canPublish ?? true,
      canSubscribe: args.canSubscribe ?? true,
      canPublishData: true,
      // Explicit source allow-list. When the caller doesn't pass one,
      // default to the full Phase 2 set: mic + camera + screen share
      // (video + audio). Phase 5 will derive this from the channel's
      // per-role permissions JSON before minting the token.
      canPublishSources: args.canPublishSources ?? [
        'microphone',
        'camera',
        'screen_share',
        'screen_share_audio',
      ],
    });
    return at.toJwt();
  }

  /** Lazily-initialized RoomServiceClient. Null when unavailable. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getRoomService(): Promise<any> {
    if (!this.isAvailable()) return null;
    if (this.roomService) return this.roomService;
    const sdk = await this.loadSdk();
    if (!sdk) return null;
    this.roomService = new sdk.RoomServiceClient(this.url, this.apiKey, this.apiSecret);
    return this.roomService;
  }

  /**
   * Verify an inbound LiveKit webhook. Returns the parsed event on success
   * or null on signature mismatch. Caller MUST treat null as a 401.
   */
  async verifyWebhook(rawBody: string, authHeader: string): Promise<unknown | null> {
    if (!this.isAvailable() || !this.webhookKey) return null;
    if (!this.webhookReceiver) {
      const sdk = await this.loadSdk();
      if (!sdk) return null;
      this.webhookReceiver = new sdk.WebhookReceiver(this.apiKey, this.apiSecret);
    }
    try {
      return await this.webhookReceiver.receive(rawBody, authHeader);
    } catch (err) {
      this.logger.warn(`LiveKit webhook verification failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Deterministic LiveKit room identity for an Atlas voice channel. */
  static roomNameForChannel(channelId: string): string {
    return `voice:${channelId}`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async loadSdk(): Promise<any> {
    if (this.sdk) return this.sdk;
    try {
      // Untyped dynamic import: see the field-level comment above for why.
      // The string is hand-built so TypeScript doesn't try to resolve it
      // at type-check time before the package is installed.
      const moduleName = 'livekit-server-sdk';
      this.sdk = await import(/* webpackIgnore: true */ moduleName);
      return this.sdk;
    } catch (err) {
      this.logger.error(
        `livekit-server-sdk failed to load (is it installed?): ${(err as Error).message}`,
      );
      return null;
    }
  }
}
