import { RedisCacheService } from '../../../shared/cache/redis-cache.service';
import {
  buildMapFeaturesCacheKey,
  MAP_FEATURES_CACHE_KEY_PREFIX,
} from './map-features-query-cache';

export class MapFeaturesQueryCacheCoordinator {
  private readonly inFlightCacheLoads = new Map<string, Promise<unknown>>();
  private cacheInvalidationGeneration = 0;

  constructor(private readonly cache?: RedisCacheService) {}

  async invalidate(): Promise<number> {
    this.cacheInvalidationGeneration++;
    this.inFlightCacheLoads.clear();

    return (
      (await this.cache?.deleteByPrefix(`${MAP_FEATURES_CACHE_KEY_PREFIX}:`)) ??
      0
    );
  }

  async getJson<T>(
    scope: string,
    payload: unknown,
    ttlSeconds: number,
    load: () => Promise<T>
  ): Promise<T> {
    if (!this.cache) return await load();

    const key = buildMapFeaturesCacheKey(scope, payload);
    const cached = await this.cache.getJson<{ value: T }>(key);

    if (cached) {
      return cached.value;
    }

    const existingLoad = this.inFlightCacheLoads.get(key) as
      | Promise<T>
      | undefined;
    if (existingLoad) {
      return await existingLoad;
    }

    const loadGeneration = this.cacheInvalidationGeneration;
    const loadPromise = load()
      .then(async (value) => {
        if (this.cacheInvalidationGeneration === loadGeneration) {
          await this.cache?.setJson(key, { value }, ttlSeconds);
        }
        return value;
      })
      .finally(() => {
        if (this.inFlightCacheLoads.get(key) === loadPromise) {
          this.inFlightCacheLoads.delete(key);
        }
      });
    this.inFlightCacheLoads.set(key, loadPromise);

    return await loadPromise;
  }
}
