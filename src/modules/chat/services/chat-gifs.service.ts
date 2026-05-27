import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ChatGif {
  id: string;
  title: string;
  previewUrl: string;
  gifUrl: string;
  mp4Url: string | null;
  width: number;
  height: number;
}

export interface ChatGifSearchResult {
  provider: 'tenor' | 'giphy';
  results: ChatGif[];
  /** Opaque pagination cursor — Tenor returns its own string; Giphy uses
   *  numeric offset which we serialise as a decimal string. Pass back as `pos`. */
  next: string | null;
}

interface TenorMediaFormats {
  tinygif?: { url: string; dims: [number, number] };
  gif?: { url: string; dims: [number, number] };
  mp4?: { url: string; dims: [number, number] };
}

interface TenorResult {
  id: string;
  content_description?: string;
  media_formats: TenorMediaFormats;
}

interface TenorEnvelope {
  results: TenorResult[];
  next?: string;
}

interface GiphyImage {
  url: string;
  width: string;
  height: string;
  mp4?: string;
}

interface GiphyResult {
  id: string;
  title?: string;
  images: {
    original: GiphyImage;
    fixed_height_small?: GiphyImage;
    preview_gif?: GiphyImage;
  };
}

interface GiphyEnvelope {
  data: GiphyResult[];
  pagination?: { total_count: number; count: number; offset: number };
}

/**
 * Server-side GIF proxy. Supports both Giphy and Tenor — keeps the API
 * keys off the browser. Provider preference: Giphy first (if its key is
 * set), then Tenor. When neither is configured we return empty results
 * so the frontend can hide the GIF tab gracefully instead of erroring.
 */
@Injectable()
export class ChatGifsService {
  private readonly logger = new Logger(ChatGifsService.name);
  private readonly tenorKey: string;
  private readonly giphyKey: string;
  private readonly tenorBase = 'https://tenor.googleapis.com/v2';
  private readonly giphyBase = 'https://api.giphy.com/v1/gifs';

  constructor(config: ConfigService) {
    this.tenorKey = config.get<string>('chat.tenorApiKey') ?? '';
    this.giphyKey = config.get<string>('chat.giphyApiKey') ?? '';
  }

  available(): boolean {
    return Boolean(this.giphyKey || this.tenorKey);
  }

  async search(q: string, pos?: string, limit = 24): Promise<ChatGifSearchResult> {
    if (this.giphyKey) return this.giphySearch(q, pos, limit);
    if (this.tenorKey) return this.tenorSearch(q, pos, limit);
    return { provider: 'tenor', results: [], next: null };
  }

  async trending(pos?: string, limit = 24): Promise<ChatGifSearchResult> {
    if (this.giphyKey) return this.giphyTrending(pos, limit);
    if (this.tenorKey) return this.tenorTrending(pos, limit);
    return { provider: 'tenor', results: [], next: null };
  }

  // ─── Giphy ──────────────────────────────────────────────────────────

  private async giphySearch(q: string, pos: string | undefined, limit: number) {
    const url = new URL(`${this.giphyBase}/search`);
    url.searchParams.set('api_key', this.giphyKey);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', String(this.clamp(limit)));
    url.searchParams.set('offset', String(this.parseOffset(pos)));
    url.searchParams.set('rating', 'pg-13');
    url.searchParams.set('bundle', 'messaging_non_clips');
    return this.fetchGiphy(url);
  }

  private async giphyTrending(pos: string | undefined, limit: number) {
    const url = new URL(`${this.giphyBase}/trending`);
    url.searchParams.set('api_key', this.giphyKey);
    url.searchParams.set('limit', String(this.clamp(limit)));
    url.searchParams.set('offset', String(this.parseOffset(pos)));
    url.searchParams.set('rating', 'pg-13');
    url.searchParams.set('bundle', 'messaging_non_clips');
    return this.fetchGiphy(url);
  }

  private async fetchGiphy(url: URL): Promise<ChatGifSearchResult> {
    let res: Response;
    try {
      res = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
    } catch (err) {
      this.logger.warn(`Giphy fetch failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('GIF provider unreachable.');
    }
    if (!res.ok) {
      this.logger.warn(`Giphy returned ${res.status}`);
      throw new ServiceUnavailableException('GIF provider error.');
    }
    const envelope = (await res.json()) as GiphyEnvelope;
    const p = envelope.pagination;
    // Giphy returns the offset of THIS page + count returned. The next
    // offset is offset + count; absent when no more results.
    const nextOffset =
      p && p.count > 0 && p.offset + p.count < p.total_count ? p.offset + p.count : null;
    return {
      provider: 'giphy',
      next: nextOffset === null ? null : String(nextOffset),
      results: envelope.data.map((r) => {
        const original = r.images.original;
        const preview = r.images.fixed_height_small ?? r.images.preview_gif ?? original;
        return {
          id: r.id,
          title: r.title ?? '',
          previewUrl: preview.url,
          gifUrl: original.url,
          mp4Url: original.mp4 ?? null,
          width: parseInt(original.width, 10) || 0,
          height: parseInt(original.height, 10) || 0,
        };
      }),
    };
  }

  // ─── Tenor ──────────────────────────────────────────────────────────

  private async tenorSearch(q: string, pos: string | undefined, limit: number) {
    const url = new URL(`${this.tenorBase}/search`);
    url.searchParams.set('q', q);
    url.searchParams.set('key', this.tenorKey);
    url.searchParams.set('limit', String(this.clamp(limit)));
    url.searchParams.set('media_filter', 'tinygif,gif,mp4');
    url.searchParams.set('contentfilter', 'medium');
    url.searchParams.set('client_key', 'mgm-atlas');
    if (pos) url.searchParams.set('pos', pos);
    return this.fetchTenor(url);
  }

  private async tenorTrending(pos: string | undefined, limit: number) {
    const url = new URL(`${this.tenorBase}/featured`);
    url.searchParams.set('key', this.tenorKey);
    url.searchParams.set('limit', String(this.clamp(limit)));
    url.searchParams.set('media_filter', 'tinygif,gif,mp4');
    url.searchParams.set('contentfilter', 'medium');
    url.searchParams.set('client_key', 'mgm-atlas');
    if (pos) url.searchParams.set('pos', pos);
    return this.fetchTenor(url);
  }

  private async fetchTenor(url: URL): Promise<ChatGifSearchResult> {
    let res: Response;
    try {
      res = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
    } catch (err) {
      this.logger.warn(`Tenor fetch failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('GIF provider unreachable.');
    }
    if (!res.ok) {
      this.logger.warn(`Tenor returned ${res.status}`);
      throw new ServiceUnavailableException('GIF provider error.');
    }
    const envelope = (await res.json()) as TenorEnvelope;
    return {
      provider: 'tenor',
      next: envelope.next ?? null,
      results: envelope.results.map((r) => {
        const gif = r.media_formats.gif ?? r.media_formats.tinygif;
        const preview = r.media_formats.tinygif ?? r.media_formats.gif;
        const mp4 = r.media_formats.mp4;
        return {
          id: r.id,
          title: r.content_description ?? '',
          previewUrl: preview?.url ?? gif?.url ?? '',
          gifUrl: gif?.url ?? '',
          mp4Url: mp4?.url ?? null,
          width: gif?.dims?.[0] ?? preview?.dims?.[0] ?? 0,
          height: gif?.dims?.[1] ?? preview?.dims?.[1] ?? 0,
        };
      }),
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private clamp(n: number): number {
    return Math.min(Math.max(n, 1), 50);
  }

  private parseOffset(pos?: string): number {
    if (!pos) return 0;
    const n = Number.parseInt(pos, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
}
