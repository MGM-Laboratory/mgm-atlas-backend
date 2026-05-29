import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * Authenticates the y-websocket sidecar (not an end user) on the internal
 * callback endpoints. The sidecar sends:
 *   x-yjs-timestamp: <ms epoch>
 *   x-yjs-signature: hex( HMAC-SHA256(secret, `${docKey}.${timestamp}`) )
 * where `secret` is YJS_INTERNAL_AUTH_SECRET. When the secret is unset
 * (sidecar not provisioned) every call is rejected — safe default.
 */
@Injectable()
export class InternalYjsGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const secret = this.config.get<string>('yjs.internalAuthSecret') ?? '';
    if (!secret) return false;

    const req = ctx.switchToHttp().getRequest<Request>();
    const ts = req.header('x-yjs-timestamp');
    const sig = req.header('x-yjs-signature');
    const docKey =
      (req.body as { docKey?: string } | undefined)?.docKey ??
      (typeof req.query.docKey === 'string' ? req.query.docKey : undefined);
    if (!ts || !sig || !docKey) return false;

    const skew = Math.abs(Date.now() - Number(ts));
    if (!Number.isFinite(skew) || skew > MAX_SKEW_MS) return false;

    const expected = createHmac('sha256', secret).update(`${docKey}.${ts}`).digest('hex');
    const provided = Buffer.from(sig);
    const wanted = Buffer.from(expected);
    return provided.length === wanted.length && timingSafeEqual(provided, wanted);
  }
}
