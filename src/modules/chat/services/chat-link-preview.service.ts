import { createHash } from 'node:crypto';
import dns from 'node:dns/promises';
import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ogs from 'open-graph-scraper';
import ipaddr from 'ipaddr.js';
import type { Redis } from 'ioredis';
import { REDIS_PUB } from '@/infra/redis/redis.module';
import { PrismaService } from '@/prisma/prisma.service';

export interface LinkPreviewResult {
  url: string;
  kind: 'link' | 'video' | 'gif';
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  siteName?: string | null;
  /** oEmbed iframe HTML for video providers (YouTube/Vimeo). */
  embedHtml?: string | null;
  cached: boolean;
}

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);
const GIF_HOSTS = new Set([
  'tenor.com',
  'www.tenor.com',
  'media.tenor.com',
  'c.tenor.com',
  'giphy.com',
  'www.giphy.com',
  'media.giphy.com',
  'media1.giphy.com',
  'media2.giphy.com',
  'media3.giphy.com',
  'media4.giphy.com',
]);

/**
 * Open Graph link preview with two-level cache (Redis L1, Postgres L2)
 * and an SSRF guard. Only HTTP(S) URLs that resolve to public IPs are
 * fetched — anything pointing at private / loopback / link-local space
 * is rejected before any outbound request happens.
 *
 * Cache key: sha256 of the canonicalised URL. Redis TTL is
 * configurable (`CHAT_LINK_PREVIEW_CACHE_TTL`, default 24h);
 * Postgres rows persist with a hard expiry of 7 days.
 */
@Injectable()
export class ChatLinkPreviewService {
  private readonly logger = new Logger(ChatLinkPreviewService.name);
  private readonly cacheTtlS: number;
  private readonly persistDays = 7;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Optional() @Inject(REDIS_PUB) private readonly redis: Redis | null,
  ) {
    this.cacheTtlS = config.get<number>('chat.linkPreviewCacheTtl') ?? 86400;
  }

  async resolve(rawUrl: string): Promise<LinkPreviewResult> {
    const url = this.canonicalize(rawUrl);
    const host = new URL(url).hostname.toLowerCase();
    const hash = createHash('sha256').update(url).digest('hex');

    // L1: Redis cache.
    if (this.redis) {
      const cached = await this.redis.get(`linkpreview:${hash}`).catch(() => null);
      if (cached) {
        return { ...JSON.parse(cached), cached: true };
      }
    }

    // L2: Postgres cache.
    const row = await this.prisma.chatLinkPreview.findUnique({ where: { urlHash: hash } });
    if (row && row.expiresAt > new Date()) {
      const out: LinkPreviewResult = {
        url: row.url,
        kind: row.kind as 'link' | 'video' | 'gif',
        title: row.title,
        description: row.description,
        imageUrl: row.imageUrl,
        siteName: row.siteName,
        embedHtml: row.embedHtml,
        cached: true,
      };
      // Re-warm L1.
      await this.warmRedis(hash, out);
      return out;
    }

    // Fast paths for known providers — skip the OG fetch entirely.
    if (GIF_HOSTS.has(host)) {
      const out: LinkPreviewResult = { url, kind: 'gif', imageUrl: url, cached: false };
      await this.persist(hash, out);
      return out;
    }
    if (YOUTUBE_HOSTS.has(host) || VIMEO_HOSTS.has(host)) {
      const oembed = await this.fetchOEmbed(url, host).catch(() => null);
      if (oembed) {
        await this.persist(hash, oembed);
        return oembed;
      }
      // fall through to OG fetch as a backup
    }

    // SSRF guard before the outbound fetch.
    await this.assertPublicHost(host);

    let parsed: Awaited<ReturnType<typeof ogs>>;
    try {
      parsed = await ogs({
        url,
        timeout: 5000,
        fetchOptions: {
          headers: { 'user-agent': 'AtlasBot/1.0 (+https://atlas.labmgm.org)' },
        },
      });
    } catch (err) {
      this.logger.warn(`OG fetch failed for ${url}: ${(err as Error).message}`);
      // Still cache a minimal preview so we don't keep retrying.
      const out: LinkPreviewResult = { url, kind: 'link', cached: false };
      await this.persist(hash, out);
      return out;
    }

    const data = parsed.result;
    if (parsed.error || !data?.success) {
      const out: LinkPreviewResult = { url, kind: 'link', cached: false };
      await this.persist(hash, out);
      return out;
    }

    // open-graph-scraper types ogImage as an array of objects with .url.
    // Cast through unknown to handle older/single-object shapes too.
    const ogImage = data.ogImage as unknown as
      | { url?: string }
      | { url?: string }[]
      | undefined;
    const image = Array.isArray(ogImage) ? (ogImage[0]?.url ?? null) : (ogImage?.url ?? null);
    const out: LinkPreviewResult = {
      url,
      kind: 'link',
      title: data.ogTitle ?? data.twitterTitle ?? null,
      description: data.ogDescription ?? data.twitterDescription ?? null,
      imageUrl: image,
      siteName: data.ogSiteName ?? null,
      cached: false,
    };
    await this.persist(hash, out);
    return out;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private canonicalize(raw: string): string {
    const u = new URL(raw);
    // Drop common tracking params; keep query intact otherwise.
    const stripped = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];
    for (const p of stripped) u.searchParams.delete(p);
    u.hash = '';
    return u.toString();
  }

  private async assertPublicHost(hostname: string): Promise<void> {
    let addrs: { address: string; family: number }[];
    try {
      addrs = await dns.lookup(hostname, { all: true });
    } catch {
      throw new BadRequestException('Could not resolve URL.');
    }
    for (const a of addrs) {
      const parsed = ipaddr.parse(a.address);
      const range = parsed.range();
      if (range !== 'unicast') {
        // private, loopback, multicast, broadcast, linkLocal, uniqueLocal, ipv4Mapped, etc.
        throw new BadRequestException(`Refusing to preview URL pointing at ${range} address.`);
      }
    }
  }

  private async fetchOEmbed(url: string, host: string): Promise<LinkPreviewResult | null> {
    const endpoint = YOUTUBE_HOSTS.has(host)
      ? `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
      : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
    try {
      const res = await fetch(endpoint, {
        signal: AbortSignal.timeout(5000),
        headers: { 'user-agent': 'AtlasBot/1.0' },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        title?: string;
        author_name?: string;
        thumbnail_url?: string;
        html?: string;
        provider_name?: string;
      };
      return {
        url,
        kind: 'video',
        title: data.title ?? null,
        description: data.author_name ? `by ${data.author_name}` : null,
        imageUrl: data.thumbnail_url ?? null,
        siteName: data.provider_name ?? null,
        embedHtml: data.html ?? null,
        cached: false,
      };
    } catch {
      return null;
    }
  }

  private async persist(hash: string, result: LinkPreviewResult): Promise<void> {
    const expiresAt = new Date(Date.now() + this.persistDays * 24 * 3600 * 1000);
    await this.prisma.chatLinkPreview.upsert({
      where: { urlHash: hash },
      create: {
        urlHash: hash,
        url: result.url,
        kind: result.kind,
        title: result.title ?? null,
        description: result.description ?? null,
        imageUrl: result.imageUrl ?? null,
        siteName: result.siteName ?? null,
        embedHtml: result.embedHtml ?? null,
        expiresAt,
      },
      update: {
        url: result.url,
        kind: result.kind,
        title: result.title ?? null,
        description: result.description ?? null,
        imageUrl: result.imageUrl ?? null,
        siteName: result.siteName ?? null,
        embedHtml: result.embedHtml ?? null,
        expiresAt,
        fetchedAt: new Date(),
      },
    });
    await this.warmRedis(hash, result);
  }

  private async warmRedis(hash: string, result: LinkPreviewResult): Promise<void> {
    if (!this.redis) return;
    await this.redis
      .set(`linkpreview:${hash}`, JSON.stringify(result), 'EX', this.cacheTtlS)
      .catch(() => {
        // Best-effort cache warming; never fail the user request.
      });
  }
}
