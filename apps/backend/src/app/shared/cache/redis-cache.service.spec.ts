import { RedisCacheService } from './redis-cache.service';

describe('RedisCacheService', () => {
  const originalDisabled = process.env.CACHE_DISABLED;

  afterEach(() => {
    if (originalDisabled === undefined) delete process.env.CACHE_DISABLED;
    else process.env.CACHE_DISABLED = originalDisabled;
  });

  it('reports disabled cache state and bounded operation counters', async () => {
    process.env.CACHE_DISABLED = 'true';
    const service = new RedisCacheService();

    expect(await service.getJson('missing')).toBeNull();
    await service.setJson('key', { value: 1 }, 30);
    expect(await service.deleteByPrefix('prefix')).toBe(0);
    expect(await service.getHealth()).toEqual({
      status: 'disabled',
      hits: 0,
      misses: 1,
      errors: 0,
      writes: 0,
      deletes: 0,
      lastLatencyMs: expect.any(Number),
      lastErrorAt: null,
    });
  });
});
