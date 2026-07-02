import { PrismaService } from '../../../prisma/prisma.service';
import { MapFeaturesStatsQuery } from './map-features-stats-query';

const uncachedLoader = async <T>(
  scope: string,
  payload: unknown,
  ttlSeconds: number,
  load: () => Promise<T>
): Promise<T> => {
  void scope;
  void payload;
  void ttlSeconds;
  return await load();
};

describe('MapFeaturesStatsQuery', () => {
  it('groups period metadata by normalized labels', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([
      {
        name: 'À tarde',
        count: '2',
      },
    ]);
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaService;
    const statsQuery = new MapFeaturesStatsQuery(prisma, uncachedLoader);

    await expect(statsQuery.getPeriods()).resolves.toEqual([
      {
        name: 'À tarde',
        count: 2,
      },
    ]);

    expect(queryRawUnsafe.mock.calls[0][0]).toContain(
      "NULLIF(periodo_normalized, '')"
    );
    expect(queryRawUnsafe.mock.calls[0][0]).toContain(
      "WHEN 'a tarde' THEN 'À tarde'"
    );
    expect(queryRawUnsafe.mock.calls[0][0]).toContain('ORDER BY sort_order ASC');
  });

  it('uses Prisma count for unfiltered date-only count queries', async () => {
    const count = jest.fn().mockResolvedValue(7);
    const prisma = {
      mapFeature: { count },
    } as unknown as PrismaService;
    const statsQuery = new MapFeaturesStatsQuery(prisma, uncachedLoader);

    await expect(
      statsQuery.getCount({
        afterDate: '2025-01-01',
        beforeDate: '2025-12-31',
      })
    ).resolves.toBe(7);

    expect(count).toHaveBeenCalledWith({
      where: {
        data_ocorrencia: {
          gte: '2025-01-01',
          lte: '2025-12-31',
        },
      },
    });
  });
});
