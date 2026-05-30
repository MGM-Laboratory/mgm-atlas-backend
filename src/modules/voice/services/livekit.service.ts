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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private egressClient: any = null;

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
    // livekit-server-sdk v2 wants `canPublishSources` as the numeric
    // TrackSource enum (re-exported from @livekit/protocol), NOT the
    // lowercase strings. Passing strings here makes toJwt() throw
    // "Cannot convert TrackSource microphone to string" because it
    // tries to invert-lookup the enum at serialization time.
    //
    // Map our public string API to enum values via sdk.TrackSource.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const TS = (sdk as any).TrackSource as Record<string, number> | undefined;
    const stringSources = args.canPublishSources ?? [
      'microphone',
      'camera',
      'screen_share',
      'screen_share_audio',
    ];
    const STRING_TO_ENUM: Record<string, string> = {
      microphone: 'MICROPHONE',
      camera: 'CAMERA',
      screen_share: 'SCREEN_SHARE',
      screen_share_audio: 'SCREEN_SHARE_AUDIO',
    };
    const enumSources = TS
      ? stringSources.map((s) => TS[STRING_TO_ENUM[s] ?? '']).filter((v) => v !== undefined)
      : undefined;

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(enumSources ? { canPublishSources: enumSources as any } : {}),
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
   * Lazily-initialized EgressClient. Null when LiveKit isn't available
   * OR when the deploy hasn't been given LiveKit Egress credentials
   * (egress runs as a separate container that polls the SFU via Redis).
   *
   * The EgressClient itself just sends RPCs to LiveKit; the egress
   * worker is what actually records. As long as the SFU URL is reachable
   * and an egress worker is running on the same Redis, this works.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getEgressClient(): Promise<any> {
    if (!this.isAvailable()) return null;
    if (this.egressClient) return this.egressClient;
    const sdk = await this.loadSdk();
    if (!sdk) return null;
    if (!sdk.EgressClient) return null;
    this.egressClient = new sdk.EgressClient(this.url, this.apiKey, this.apiSecret);
    return this.egressClient;
  }

  /**
   * Start a room composite egress (mixed audio + video) and upload the
   * result to S3. Audio-only is selected via `audioOnly: true` in
   * options — useful when the channel hasn't enabled video.
   *
   * Caller is responsible for the gate (mod-only) and for persisting
   * the returned egressId. We pass S3 credentials in the request so
   * the egress worker doesn't need them in its environment.
   */
  async startRoomCompositeEgress(args: {
    roomName: string;
    s3: {
      accessKey: string;
      secret: string;
      region: string;
      bucket: string;
    };
    filepath: string;
    audioOnly?: boolean;
  }): Promise<{ egressId: string } | null> {
    const egress = await this.getEgressClient();
    if (!egress) return null;
    const sdk = await this.loadSdk();
    if (!sdk) return null;

    // LiveKit's request shape (livekit-server-sdk v2): a layout name,
    // a file output, and an upload destination. We choose 'grid-light'
    // for the room composite layout — the visual default in LiveKit's
    // egress template that fits most calls.
    const fileOutput = {
      fileType: sdk.EncodedFileType?.MP4 ?? 1, // MP4 = 1 in the enum
      filepath: args.filepath,
      s3: {
        accessKey: args.s3.accessKey,
        secret: args.s3.secret,
        region: args.s3.region,
        bucket: args.s3.bucket,
      },
    };

    try {
      const info = await egress.startRoomCompositeEgress(
        args.roomName,
        {
          file: fileOutput,
        },
        {
          layout: 'grid',
          audioOnly: args.audioOnly === true,
          videoOnly: false,
        },
      );
      return { egressId: info.egressId };
    } catch (err) {
      this.logger.warn(`startRoomCompositeEgress failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Stop a running egress by id. Returns true on a successful stop request. */
  async stopEgress(egressId: string): Promise<boolean> {
    const egress = await this.getEgressClient();
    if (!egress) return false;
    try {
      await egress.stopEgress(egressId);
      return true;
    } catch (err) {
      this.logger.warn(`stopEgress(${egressId}) failed: ${(err as Error).message}`);
      return false;
    }
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
