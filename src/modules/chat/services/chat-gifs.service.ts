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
  provider: 'tenor';
  results: ChatGif[];
  /** Tenor opaque pagination cursor; pass back as `pos`. */
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

/**
 * Server-side proxy for Tenor v2 — keeps TENOR_API_KEY off the
 * browser. When the key is unset we return an empty result so the
 * frontend can hide the GIF tab gracefully instead of erroring.
 */
@Injectable()
export class ChatGifsService {
  private readonly logger = new Logger(ChatGifsService.name);
  private readonly apiKey: string;
  private readonly base = 'https://tenor.googleapis.com/v2';

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('chat.tenorApiKey') ?? '';
  }

  available(): boolean {
    return Boolean(this.apiKey);
  }

  async search(q: string, pos?: string, limit = 24): Promise<ChatGifSearchResult> {
    if (!this.apiKey) return { provider: 'tenor', results: [], next: null };
    const url = new URL(`${this.base}/search`);
    url.searchParams.set('q', q);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 50)));
    url.searchParams.set('media_filter', 'tinygif,gif,mp4');
    url.searchParams.set('contentfilter', 'medium');
    url.searchParams.set('client_key', 'mgm-atlas');
    if (pos) url.searchParams.set('pos', pos);
    return this.fetchAndNormalize(url);
  }

  async trending(pos?: string, limit = 24): Promise<ChatGifSearchResult> {
    if (!this.apiKey) return { provider: 'tenor', results: [], next: null };
    const url = new URL(`${this.base}/featured`);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 50)));
    url.searchParams.set('media_filter', 'tinygif,gif,mp4');
    url.searchParams.set('contentfilter', 'medium');
    url.searchParams.set('client_key', 'mgm-atlas');
    if (pos) url.searchParams.set('pos', pos);
    return this.fetchAndNormalize(url);
  }

  private async fetchAndNormalize(url: URL): Promise<ChatGifSearchResult> {
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
}
