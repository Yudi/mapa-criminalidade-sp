import { RedisCacheService } from '../../../shared/cache/redis-cache.service';
import { MapFeaturesQueryCacheCoordinator } from './map-features-query-cache-coordinator';

type CacheMock = Pick<
  RedisCacheService,
  'getJson' | 'setJson' | 'deleteByPrefix'
>;

function createCacheMock(): jest.Mocked<CacheMock> {
  const jsonStore = new Map<string, unknown>();

  return {
    getJson: jest.fn(async (key: string): Promise<unknown | null> => {
      return jsonStore.get(key) ?? null;
    }),
    setJson: jest.fn(
      async (
        key: string,
        value: unknown,
        ttlSeconds: number
      ): Promise<void> => {
        void ttlSeconds;
        jsonStore.set(key, value);
      }
    ),
    deleteByPrefix: jest.fn(async (prefix: string): Promise<number> => {
      let deleted = 0;

      for (const key of jsonStore.keys()) {
        if (key.startsWith(prefix)) {
          jsonStore.delete(key);
          deleted++;
        }
      }

      return deleted;
    }),
  } as unknown as jest.Mocked<CacheMock>;
}

describe('MapFeaturesQueryCacheCoordinator', () => {
  it('shares concurrent cache misses for the same key', async () => {
    const cache = createCacheMock();
    const coordinator = new MapFeaturesQueryCacheCoordinator(
      cache as unknown as RedisCacheService
    );
    const load = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { total: 2 };
    });

    await expect(
      Promise.all([
        coordinator.getJson('charts', { categories: ['Roubo'] }, 60, load),
        coordinator.getJson('charts', { categories: ['Roubo'] }, 60, load),
      ])
    ).resolves.toEqual([{ total: 2 }, { total: 2 }]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.setJson).toHaveBeenCalledTimes(1);
  });

  it('does not write an in-flight value after invalidation', async () => {
    const cache = createCacheMock();
    const coordinator = new MapFeaturesQueryCacheCoordinator(
      cache as unknown as RedisCacheService
    );
    let resolveLoad!: (value: string) => void;
    const staleLoad = new Promise<string>((resolve) => {
      resolveLoad = resolve;
    });

    const result = coordinator.getJson('categories', {}, 60, () => staleLoad);
    await Promise.resolve();

    await coordinator.invalidate();
    resolveLoad('old value');

    await expect(result).resolves.toBe('old value');
    expect(cache.setJson).not.toHaveBeenCalled();
    expect(cache.deleteByPrefix).toHaveBeenCalledWith('map-features:v2:');
  });
});
