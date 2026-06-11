import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

interface CacheEntry {
  flags: Record<string, boolean>;
  at: number;
}

/**
 * DB-backed feature flags with a short in-memory cache. Evaluation is
 * fail-safe: an unknown key, or any read error, resolves to `false`, so a
 * flag that doesn't exist yet can never accidentally enable a feature.
 */
@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private static readonly CACHE_TTL_MS = 30_000;
  private cache: CacheEntry | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** All flags as an evaluated `{ key: enabled }` map (cached ~30s). */
  async evaluateAll(): Promise<Record<string, boolean>> {
    if (this.cache && Date.now() - this.cache.at < FeatureFlagsService.CACHE_TTL_MS) {
      return this.cache.flags;
    }
    try {
      const rows = await this.prisma.featureFlag.findMany({
        select: { key: true, enabled: true },
      });
      const flags: Record<string, boolean> = {};
      for (const r of rows) flags[r.key] = r.enabled;
      this.cache = { flags, at: Date.now() };
      return flags;
    } catch (err) {
      // Fail safe: never let a flag-store hiccup take features down or on.
      this.logger.warn(`feature flag read failed; serving last cache / empty: ${String(err)}`);
      return this.cache?.flags ?? {};
    }
  }

  /** Single flag; unknown key → false. */
  async isEnabled(key: string): Promise<boolean> {
    const flags = await this.evaluateAll();
    return flags[key] ?? false;
  }

  // ─── Admin operations ────────────────────────────────────────────────────

  list() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  async upsert(key: string, enabled: boolean, description: string | undefined, updatedBy: string) {
    const flag = await this.prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled, description, updatedBy },
      update: { enabled, description, updatedBy },
    });
    this.cache = null; // invalidate so the change is visible within a request
    return flag;
  }

  async remove(key: string) {
    await this.prisma.featureFlag.delete({ where: { key } });
    this.cache = null;
    return { ok: true };
  }
}
