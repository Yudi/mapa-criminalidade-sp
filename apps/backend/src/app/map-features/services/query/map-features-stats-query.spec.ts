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
  it('maps all joint time buckets without converting an unknown hour into midnight', async () => {
    const buckets = [
      { weekday: 1, hour: 0, count: 2 },
      { weekday: 1, hour: null, count: 3 },
      { weekday: null, hour: 9, count: 1 },
      { weekday: null, hour: null, count: 4 },
    ];
    const executeReadOnlyStatsQuery = jest
      .fn()
      .mockResolvedValue([
        { total_features: '10', weekday_hour_distribution: buckets },
      ]);
    const query = new MapFeaturesStatsQuery(
      { executeReadOnlyStatsQuery } as unknown as PrismaService,
      uncachedLoader
    );
    const result = await query.getCharts({
      categories: ['Furto'],
      startHour: 22,
      endHour: 4,
    });
    expect(result.weekdayHourDistribution).toEqual(buckets);
    const [sql, ...values] = executeReadOnlyStatsQuery.mock.calls[0];
    expect(sql).toContain(
      'EXTRACT(ISODOW FROM data_ocorrencia)::int AS weekday'
    );
    expect(sql).toContain(
      'CASE WHEN hora_ocorrencia BETWEEN 0 AND 23 THEN hora_ocorrencia END AS hour'
    );
    expect(sql).toContain('(hora_ocorrencia >= $2 OR hora_ocorrencia <= $3)');
    expect(values).toEqual(['Furto', 22, 4]);
  });
  it('groups period metadata by normalized labels', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([
      {
        name: 'À tarde',
        count: '2',
      },
    ]);
    const prisma = {
      executeReadOnlyStatsQuery: queryRawUnsafe,
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
    expect(queryRawUnsafe.mock.calls[0][0]).toContain(
      'ORDER BY sort_order ASC'
    );
  });

  it('uses the deadline-bound query path for date-only counts', async () => {
    const count = jest.fn().mockResolvedValue([{ count: '7' }]);
    const prisma = {
      executeReadOnlyStatsQuery: count,
    } as unknown as PrismaService;
    const statsQuery = new MapFeaturesStatsQuery(prisma, uncachedLoader);

    await expect(
      statsQuery.getCount({
        afterDate: '2025-01-01',
        beforeDate: '2025-12-31',
      })
    ).resolves.toBe(7);

    expect(count).toHaveBeenCalledWith(
      expect.stringContaining(
        'data_ocorrencia <= $1 AND data_ocorrencia >= $2'
      ),
      '2025-12-31',
      '2025-01-01'
    );
  });
});

describe('temporal statistics', () => {
  it('uses one bounded spatial scan and retains every category', async () => {
    const categories = Array.from({ length: 15 }, (_, index) => ({
      label: `Category ${index}`,
      count: 1,
    }));
    const executeReadOnlyStatsQuery = jest.fn().mockResolvedValue([
      {
        dataset_revision: '17',
        total: '15',
        monthly: [{ label: '2025-01', count: 15 }],
        categories,
      },
    ]);
    const query = new MapFeaturesStatsQuery(
      { executeReadOnlyStatsQuery } as unknown as PrismaService,
      uncachedLoader
    );
    const result = await query.getTemporalStats({
      afterDate: '2025-01-01',
      beforeDate: '2025-12-31',
      area: { longitude: -46.6, latitude: -23.5, radius: 500 },
      categories: ['Furto'],
      startHour: 22,
      endHour: 4,
    });
    expect(result.total).toBe(15);
    expect(result.datasetRevision).toBe('17');
    expect(result.categories).toHaveLength(15);
    expect(result.monthly).toEqual([
      { label: '2025-01', count: 15, amount: null },
    ]);
    const [sql, ...params] = executeReadOnlyStatsQuery.mock.calls[0];
    expect(sql).toContain('ST_DWithin');
    expect(sql).toContain('SELECT DISTINCT category_name');
    expect(sql).toContain('jsonb_agg(months ORDER BY label)');
    expect(sql).not.toContain('LIMIT');
    expect(sql).toContain('(hora_ocorrencia >= $4 OR hora_ocorrencia <= $5)');
    expect(params).toEqual([
      '2025-12-31',
      '2025-01-01',
      'Furto',
      22,
      4,
      -46.6,
      -23.5,
      500,
    ]);
  });
  it('returns empty aggregates without inventing coverage', async () => {
    const query = new MapFeaturesStatsQuery(
      {
        executeReadOnlyStatsQuery: jest.fn().mockResolvedValue([]),
      } as unknown as PrismaService,
      uncachedLoader
    );
    expect(await query.getTemporalStats({})).toEqual({
      datasetRevision: null,
      total: 0,
      monthly: [],
      categories: [],
    });
  });
});
