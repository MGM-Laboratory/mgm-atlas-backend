import { Injectable, Logger } from '@nestjs/common';
import { SessionService } from '@/modules/auth/session.service';
import { ProjectAccessService } from '@/modules/projects/project-access.service';
import { PrismaService } from '@/prisma/prisma.service';
import { YjsTokenService } from './yjs-token.service';

export interface YjsAuthorizeResult {
  allow: boolean;
  canEdit?: boolean;
  projectId?: string;
  user?: { id: string; name: string };
}

type DocScope = { kind: 'note' | 'whiteboard'; id: string };

@Injectable()
export class YjsService {
  private readonly logger = new Logger(YjsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly access: ProjectAccessService,
    private readonly tokens: YjsTokenService,
  ) {}

  /** Called by the sidecar on every join. Returns allow:false on any failure. */
  async authorize(docKey: string, token: string): Promise<YjsAuthorizeResult> {
    let sid: string;
    try {
      sid = this.tokens.verify(token).sid;
    } catch {
      return { allow: false };
    }

    const user = await this.sessions.validateBearerAndLoadUser(sid);
    if (!user) return { allow: false };

    const scope = this.parseDocKey(docKey);
    if (!scope) return { allow: false };

    const projectId = await this.resolveProjectId(scope);
    if (!projectId) return { allow: false };

    try {
      const { access } = await this.access.resolve(projectId, user);
      if (!access.isInsider) return { allow: false };
      return { allow: true, canEdit: true, projectId, user: { id: user.id, name: user.name } };
    } catch {
      // resolve throws 403/404 for no-access / missing project → treat as deny.
      return { allow: false };
    }
  }

  /** Initial document state for the sidecar to seed a freshly-opened room. */
  async loadSnapshot(docKey: string): Promise<{ state: string | null; version: number }> {
    const snap = await this.prisma.yDocSnapshot.findUnique({ where: { docKey } });
    if (!snap || snap.size === 0) return { state: null, version: snap?.version ?? 0 };
    return { state: Buffer.from(snap.state).toString('base64'), version: snap.version };
  }

  /** Persist the debounced CRDT state. Upserts so a missing row self-heals. */
  async saveSnapshot(docKey: string, stateB64: string, size: number): Promise<{ ok: boolean }> {
    const state = Buffer.from(stateB64, 'base64');
    await this.prisma.yDocSnapshot.upsert({
      where: { docKey },
      create: { docKey, state, size },
      update: { state, size, version: { increment: 1 } },
    });
    return { ok: true };
  }

  private parseDocKey(docKey: string): DocScope | null {
    const [kind, id] = docKey.split(':');
    if ((kind === 'note' || kind === 'whiteboard') && id) return { kind, id };
    return null;
  }

  private async resolveProjectId(scope: DocScope): Promise<string | null> {
    if (scope.kind === 'note') {
      const note = await this.prisma.projectNote.findFirst({
        where: { id: scope.id, deletedAt: null },
        select: { projectId: true },
      });
      return note?.projectId ?? null;
    }
    const wb = await this.prisma.whiteboard.findFirst({
      where: { id: scope.id, deletedAt: null },
      select: { projectId: true },
    });
    return wb?.projectId ?? null;
  }
}
