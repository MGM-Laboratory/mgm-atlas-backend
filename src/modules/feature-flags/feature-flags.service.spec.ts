import { FeatureFlagsService } from './feature-flags.service';

describe('FeatureFlagsService', () => {
  function make(rows: { key: string; enabled: boolean }[], opts: { throws?: boolean } = {}) {
    const findMany = jest.fn(() => (opts.throws ? Promise.reject(new Error('db down')) : Promise.resolve(rows)));
    const prisma = { featureFlag: { findMany } } as any;
    return { service: new FeatureFlagsService(prisma), findMany };
  }

  it('evaluates known flags and defaults unknown keys to false', async () => {
    const { service } = make([
      { key: 'ui.maintenance_banner', enabled: true },
      { key: 'ui.beta', enabled: false },
    ]);
    expect(await service.isEnabled('ui.maintenance_banner')).toBe(true);
    expect(await service.isEnabled('ui.beta')).toBe(false);
    expect(await service.isEnabled('does.not.exist')).toBe(false);
  });

  it('caches reads for ~30s (single DB hit within the window)', async () => {
    const { service, findMany } = make([{ key: 'a', enabled: true }]);
    await service.evaluateAll();
    await service.evaluateAll();
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('fails safe to empty (all false) when the store errors', async () => {
    const { service } = make([], { throws: true });
    expect(await service.evaluateAll()).toEqual({});
    expect(await service.isEnabled('anything')).toBe(false);
  });
});
