import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface YTokenPayload {
  /// The Atlas session id this token authorizes on behalf of.
  sid: string;
}

/**
 * Mints/verifies the short-lived JWT the frontend hands to the y-websocket
 * sidecar. Signed with INTERNAL_JWT_SECRET (configured on the JwtModule);
 * the sidecar never inspects it — it forwards it to /internal/yjs/authorize
 * where we verify the signature and re-check the underlying session.
 */
@Injectable()
export class YjsTokenService {
  constructor(private readonly jwt: JwtService) {}

  mint(sessionId: string): string {
    return this.jwt.sign({ sid: sessionId } satisfies YTokenPayload);
  }

  verify(token: string): YTokenPayload {
    return this.jwt.verify<YTokenPayload>(token);
  }
}
