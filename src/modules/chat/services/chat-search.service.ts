import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '@/common/types/authenticated-user.type';
import { PrismaService } from '@/prisma/prisma.service';

export type ChatSearchScope = 'channel' | 'project' | 'global';

export interface ChatSearchHit {
  id: string;
  channelId: string;
  channelName: string;
  /** null for hits in workspace-global channels (projectId = null). */
  projectId: string | null;
  projectSlug: string | null;
  projectTitle: string | null;
  authorId: string;
  authorName: string;
  /** Snippet with <mark>…</mark> wrapping the matched terms (escaped). */
  snippet: string;
  rank: number;
  createdAt: Date;
}

export interface ChatSearchResult {
  scope: ChatSearchScope;
  query: string;
  hits: ChatSearchHit[];
  nextCursor: string | null;
}

interface SearchOptions {
  user: AuthenticatedUser;
  scope: ChatSearchScope;
  q: string;
  channelId?: string;
  projectId?: string;
  cursor?: string;
  limit?: number;
}

interface RawHit {
  id: string;
  channelId: string;
  channelName: string;
  projectId: string | null;
  projectSlug: string | null;
  projectTitle: string | null;
  authorId: string;
  authorName: string;
  snippet: string;
  rank: number;
  createdAt: Date;
}

/**
 * Postgres full-text search over the `searchVector` column added in
 * the P1 migration (GIN-indexed, generated from `markdown` via a
 * STORED generated column — always fresh, no app-side maintenance).
 *
 * Scope is enforced server-side regardless of what channelId /
 * projectId the client passes — we derive the legal channel set from
 * ProjectMember rows (or "all" for admins) and AND it in. A user can
 * never search a channel they shouldn't see.
 *
 * Snippet generation uses ts_headline so matched terms get
 * <mark>…</mark> wrapping that the frontend can render with the
 * existing rehype-sanitize allowlist (we extend it to allow <mark>).
 */
@Injectable()
export class ChatSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(opts: SearchOptions): Promise<ChatSearchResult> {
    const term = opts.q.trim();
    if (!term) {
      return { scope: opts.scope, query: term, hits: [], nextCursor: null };
    }
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);

    // Derive the allowed channel-id set from the requested scope.
    const channelIds = await this.resolveScope(opts);
    if (channelIds.length === 0) {
      return { scope: opts.scope, query: term, hits: [], nextCursor: null };
    }

    // Cursor: opaque createdAt timestamp of the last hit in the prior page.
    let cursorClause = Prisma.empty;
    if (opts.cursor) {
      const ts = new Date(opts.cursor);
      if (Number.isNaN(ts.getTime())) {
        throw new BadRequestException('Invalid cursor.');
      }
      cursorClause = Prisma.sql`AND m."createdAt" < ${ts}`;
    }

    const rows = await this.prisma.$queryRaw<RawHit[]>(
      Prisma.sql`
        SELECT
          m."id"          AS "id",
          m."channelId"   AS "channelId",
          c."name"        AS "channelName",
          c."projectId"   AS "projectId",
          p."slug"        AS "projectSlug",
          p."title"       AS "projectTitle",
          m."authorId"    AS "authorId",
          u."name"        AS "authorName",
          ts_headline(
            'simple',
            COALESCE(m."markdown", ''),
            plainto_tsquery('simple', ${term}),
            'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MinWords=4, MaxWords=18, FragmentDelimiter=" … "'
          ) AS "snippet",
          ts_rank_cd(m."searchVector", plainto_tsquery('simple', ${term})) AS "rank",
          m."createdAt"   AS "createdAt"
        FROM "ChatMessage" m
        JOIN "ChatChannel" c ON c."id" = m."channelId"
        -- LEFT: workspace-global channels have projectId = NULL and must
        -- still surface (with null project columns), not get inner-joined away.
        LEFT JOIN "Project" p ON p."id" = c."projectId"
        JOIN "User"        u ON u."id" = m."authorId"
        WHERE
          m."deletedAt" IS NULL
          AND m."channelId" IN (${Prisma.join(channelIds)})
          AND m."searchVector" @@ plainto_tsquery('simple', ${term})
          ${cursorClause}
        ORDER BY rank DESC, m."createdAt" DESC
        LIMIT ${limit + 1}
      `,
    );

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map<ChatSearchHit>((r) => ({
      ...r,
      rank: Number(r.rank),
    }));
    // Use the last item's createdAt as the next cursor — works because
    // we order by rank then createdAt; cursor advances time backwards.
    const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null;
    return { scope: opts.scope, query: term, hits: items, nextCursor };
  }

  /**
   * Returns the set of channel ids the user is allowed to search,
   * narrowed by the requested scope. For channel scope we additionally
   * verify the channel belongs to a project the user has access to.
   */
  private async resolveScope(opts: SearchOptions): Promise<string[]> {
    const accessibleProjectIds = await this.accessibleProjectIds(opts.user);

    if (opts.scope === 'channel') {
      if (!opts.channelId) {
        throw new BadRequestException('channelId is required for channel-scoped search.');
      }
      const channel = await this.prisma.chatChannel.findUnique({
        where: { id: opts.channelId },
        select: { id: true, projectId: true },
      });
      if (!channel) return [];
      // Workspace-global channels are searchable by every authenticated user.
      if (channel.projectId === null) return [channel.id];
      if (!accessibleProjectIds.includes(channel.projectId)) return [];
      return [channel.id];
    }

    if (opts.scope === 'project') {
      if (!opts.projectId) {
        throw new BadRequestException('projectId is required for project-scoped search.');
      }
      if (!accessibleProjectIds.includes(opts.projectId)) return [];
      const channels = await this.prisma.chatChannel.findMany({
        where: { projectId: opts.projectId },
        select: { id: true },
      });
      return channels.map((c) => c.id);
    }

    // global: every accessible project's channels plus the workspace-global
    // channels (projectId = null), which everyone may search.
    const channels = await this.prisma.chatChannel.findMany({
      where: { OR: [{ projectId: { in: accessibleProjectIds } }, { projectId: null }] },
      select: { id: true },
    });
    return channels.map((c) => c.id);
  }

  private async accessibleProjectIds(user: AuthenticatedUser): Promise<string[]> {
    if (user.isAdmin) {
      const projects = await this.prisma.project.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      return projects.map((p) => p.id);
    }
    const memberships = await this.prisma.projectMember.findMany({
      where: { userId: user.id, project: { deletedAt: null } },
      select: { projectId: true },
    });
    return memberships.map((m) => m.projectId);
  }
}
