import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisCacheService } from '../../shared/cache/redis-cache.service';
import { MapFeaturesQueryService } from './map-features-query.service';

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

describe('MapFeaturesQueryService', () => {
  it('loads the cached date range maintained by database triggers', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      earliest_date: new Date('2013-01-01T00:00:00.000Z'),
      latest_date: new Date('2025-12-31T00:00:00.000Z'),
      default_after_date: new Date('2025-09-30T00:00:00.000Z'),
    });
    const prisma = {
      mapFeaturesDateRange: { findUnique },
    } as unknown as PrismaService;
    const service = new MapFeaturesQueryService(prisma);

    await expect(service.getDateRange()).resolves.toEqual({
      earliest: '2013-01-01',
      latest: '2025-12-31',
      defaultAfter: '2025-09-30',
    });

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: {
        earliest_date: true,
        latest_date: true,
        default_after_date: true,
      },
    });
  });

  it('returns an empty date range when the cache row is unavailable', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const prisma = {
      mapFeaturesDateRange: { findUnique },
    } as unknown as PrismaService;
    const service = new MapFeaturesQueryService(prisma);

    await expect(service.getDateRange()).resolves.toEqual({
      earliest: null,
      latest: null,
      defaultAfter: null,
    });
  });

  it('groups period metadata by normalized period labels', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([
      {
        name: 'À tarde',
        count: '2',
      },
    ]);
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaService;
    const service = new MapFeaturesQueryService(prisma);

    await expect(service.getPeriods()).resolves.toEqual([
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

  it('normalizes selected period filters before querying', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaService;
    const service = new MapFeaturesQueryService(prisma);

    await service.getCategories({
      periods: ['  À   TARDE  '],
    });

    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.any(String),
      'a tarde'
    );
  });

  it('builds valid envelope filters for bounded stats queries', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaService;
    const service = new MapFeaturesQueryService(prisma);
    const bounds = {
      minLon: -47,
      minLat: -24,
      maxLon: -46,
      maxLat: -23,
    };

    await service.getCategories(bounds);
    await service.getPeriods(bounds);

    for (const [query] of queryRawUnsafe.mock.calls) {
      expect(query).toContain(
        'geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)'
      );
      expect(query).not.toContain('ST_MakeEnvelope($1, $2, $3, $4, 4326))');
    }
  });

  it('loads category and period statistics from one bounded map feature scan', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([
      {
        categories: [
          {
            category: 'Furto',
            count: '3',
            rubrica_for_styling: 'Furto',
            is_rubrica: true,
          },
        ],
        periods: [{ name: 'À tarde', count: '2', sort_order: 3 }],
      },
    ]);
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaService;
    const service = new MapFeaturesQueryService(prisma);

    await expect(
      service.getCategoryPeriodStats({
        minLon: -47,
        minLat: -24,
        maxLon: -46,
        maxLat: -23,
        periods: ['À tarde'],
      })
    ).resolves.toEqual({
      categories: [
        {
          name: 'Furto',
          count: 3,
          rubricaForStyling: 'Furto',
          sourceType: 'rubrica',
        },
      ],
      periods: [{ name: 'À tarde', count: 2 }],
    });

    const [query] = queryRawUnsafe.mock.calls[0] as [string];
    expect((query.match(/FROM map_features/g) ?? []).length).toBe(1);
    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.any(String),
      -47,
      -24,
      -46,
      -23,
      'a tarde'
    );
  });

  it('uses the registration police unit when looking up older BO numbers', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      mapFeature: { findMany },
    } as unknown as PrismaService;
    const service = new MapFeaturesQueryService(prisma);

    await service.getFeatureSummariesByBo('123', 2021, '1º DP');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          num_bo: '123',
          ano_bo: 2021,
          delegacia: '1º DP',
        },
      })
    );
  });

  it('looks up IML records across indexed yearly raw tables', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      { table_name: 'registro_obitos_iml_2025' },
      { table_name: 'registro_obitos_iml_2026' },
    ]);
    const queryRawUnsafe = jest.fn().mockResolvedValue([
      {
        source_id: 10,
        source_table: 'registro_obitos_iml_2026',
        data_entrada_iml: '01/02/2026 09:05:00',
        ano_bo: '2025',
        num_bo: 'AB-123',
        delegacia_registro: '01º D.P. - Mauá',
        numero_laudo: '55',
        ano_laudo: '2026',
        idade_vitima: '30',
        tipo_idade: 'ANOS',
        conclusao: '',
        declaracao_obito: '123',
        causa_mortis: 'Politraumatismo',
      },
    ]);
    const prisma = {
      $queryRaw: queryRaw,
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaService;
    const service = new MapFeaturesQueryService(prisma);

    await expect(
      service.getImlRecordsByBo('AB-123', 2025, '01º D.P. - Mauá')
    ).resolves.toEqual([
      expect.objectContaining({
        sourceId: 10,
        sourceTable: 'registro_obitos_iml_2026',
        causaMortis: 'Politraumatismo',
      }),
    ]);

    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UNION ALL'),
      'AB 123',
      '2025',
      '01 D P MAUA'
    );
    expect(queryRawUnsafe.mock.calls[0][0]).toContain(
      "to_timestamp(data_entrada_iml, 'DD/MM/YYYY HH24:MI:SS')"
    );
    expect(queryRawUnsafe.mock.calls[0][0]).toContain('END NULLS LAST');
  });

  it('generates tiles inside a read-only transaction with a local statement timeout', async () => {
    const tile = Buffer.from([1, 2, 3]);
    const executeRawUnsafe = jest.fn().mockResolvedValue(undefined);
    const queryRawUnsafe = jest.fn().mockResolvedValue([{ mvt: tile }]);
    const transaction = jest
      .fn()
      .mockImplementation(async (operation) =>
        operation({
          $executeRawUnsafe: executeRawUnsafe,
          $queryRawUnsafe: queryRawUnsafe,
        })
      );
    const prisma = {
      $transaction: transaction,
    } as unknown as PrismaService;
    const service = new MapFeaturesQueryService(prisma);

    await expect(service.getTile({ z: 12, x: 100, y: 200 })).resolves.toEqual({
      status: 'ok',
      tile,
    });

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 30_000,
      timeout: 31_000,
    });
    expect(executeRawUnsafe).toHaveBeenNthCalledWith(
      1,
      'SET TRANSACTION READ ONLY'
    );
    expect(executeRawUnsafe).toHaveBeenNthCalledWith(
      2,
      "SET LOCAL statement_timeout = '30000ms'"
    );
    expect(executeRawUnsafe).toHaveBeenNthCalledWith(
      3,
      'SET LOCAL plan_cache_mode = force_custom_plan'
    );
    expect(executeRawUnsafe).toHaveBeenNthCalledWith(
      4,
      "SET LOCAL work_mem = '32MB'"
    );
    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('SELECT public.occurrences'),
      12,
      100,
      200,
      '{}'
    );
  });

  it('normalizes bytea vector tile results to a Buffer', async () => {
    const tile = new Uint8Array([26, 197, 95]);
    const executeRawUnsafe = jest.fn().mockResolvedValue(undefined);
    const queryRawUnsafe = jest.fn().mockResolvedValue([{ mvt: tile }]);
    const transaction = jest
      .fn()
      .mockImplementation(async (operation) =>
        operation({
          $executeRawUnsafe: executeRawUnsafe,
          $queryRawUnsafe: queryRawUnsafe,
        })
      );
    const prisma = {
      $transaction: transaction,
    } as unknown as PrismaService;
    const service = new MapFeaturesQueryService(prisma);

    const result = await service.getTile({ z: 12, x: 100, y: 200 });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      throw new Error(`Expected ok tile status, got ${result.status}`);
    }
    expect(Buffer.isBuffer(result.tile)).toBe(true);
    expect([...result.tile]).toEqual([...tile]);
  });

  it('does not use the JSON cache for vector tiles', async () => {
    const tile = Buffer.from([1, 2, 3]);
    const executeRawUnsafe = jest.fn().mockResolvedValue(undefined);
    const queryRawUnsafe = jest.fn().mockResolvedValue([{ mvt: tile }]);
    const transaction = jest
      .fn()
      .mockImplementation(async (operation) =>
        operation({
          $executeRawUnsafe: executeRawUnsafe,
          $queryRawUnsafe: queryRawUnsafe,
        })
      );
    const prisma = {
      $transaction: transaction,
    } as unknown as PrismaService;
    const cache = createCacheMock();
    const service = new MapFeaturesQueryService(
      prisma,
      cache as unknown as RedisCacheService
    );

    await expect(service.getTile({ z: 12, x: 100, y: 200 })).resolves.toEqual({
      status: 'ok',
      tile,
    });
    await expect(service.getTile({ z: 12, x: 100, y: 200 })).resolves.toEqual({
      status: 'ok',
      tile,
    });

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(cache.getJson).not.toHaveBeenCalled();
    expect(cache.setJson).not.toHaveBeenCalled();
  });

  it('caches chart aggregations through Redis', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([
      {
        total_features: '2',
        total_records: '3',
        category_distribution: [],
        period_distribution: [],
        weekday_distribution: [],
        record_type_distribution: [],
        object_type_distribution: [],
        vehicle_brand_distribution: [],
        phone_brand_distribution: [],
        location_type_distribution: [],
        police_unit_distribution: [],
        weapon_type_distribution: [],
        drug_type_distribution: [],
      },
    ]);
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaService;
    const cache = createCacheMock();
    const service = new MapFeaturesQueryService(
      prisma,
      cache as unknown as RedisCacheService
    );
    const filter = {
      minLon: -47,
      minLat: -24,
      maxLon: -46,
      maxLat: -23,
      categories: ['Furto', 'Roubo'],
    };

    await expect(service.getCharts(filter)).resolves.toMatchObject({
      totalFeatures: 2,
      totalRecords: 3,
    });
    await expect(
      service.getCharts({
        ...filter,
        categories: ['Roubo', 'Furto'],
      })
    ).resolves.toMatchObject({
      totalFeatures: 2,
      totalRecords: 3,
    });

    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(cache.setJson).toHaveBeenCalledTimes(1);
  });

  it('shares concurrent cache misses for the same chart query', async () => {
    const queryRawUnsafe = jest.fn(
      async (): Promise<
        Array<{
          total_features: string;
          total_records: string;
          category_distribution: unknown[];
          period_distribution: unknown[];
          weekday_distribution: unknown[];
          record_type_distribution: unknown[];
          object_type_distribution: unknown[];
          vehicle_brand_distribution: unknown[];
          phone_brand_distribution: unknown[];
          location_type_distribution: unknown[];
          police_circumscription_distribution: unknown[];
          police_unit_distribution: unknown[];
          weapon_type_distribution: unknown[];
          drug_type_distribution: unknown[];
        }>
      > => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return [
          {
            total_features: '2',
            total_records: '3',
            category_distribution: [],
            period_distribution: [],
            weekday_distribution: [],
            record_type_distribution: [],
            object_type_distribution: [],
            vehicle_brand_distribution: [],
            phone_brand_distribution: [],
            location_type_distribution: [],
            police_circumscription_distribution: [],
            police_unit_distribution: [],
            weapon_type_distribution: [],
            drug_type_distribution: [],
          },
        ];
      }
    );
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaService;
    const cache = createCacheMock();
    const service = new MapFeaturesQueryService(
      prisma,
      cache as unknown as RedisCacheService
    );
    const filter = {
      minLon: -47,
      minLat: -24,
      maxLon: -46,
      maxLat: -23,
    };

    await expect(
      Promise.all([service.getCharts(filter), service.getCharts(filter)])
    ).resolves.toEqual([
      expect.objectContaining({ totalFeatures: 2, totalRecords: 3 }),
      expect.objectContaining({ totalFeatures: 2, totalRecords: 3 }),
    ]);

    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(cache.setJson).toHaveBeenCalledTimes(1);
  });

  it('invalidates cached map feature reads by prefix', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([
      {
        total_features: '2',
        total_records: '3',
        category_distribution: [],
        period_distribution: [],
        weekday_distribution: [],
        record_type_distribution: [],
        object_type_distribution: [],
        vehicle_brand_distribution: [],
        phone_brand_distribution: [],
        location_type_distribution: [],
        police_circumscription_distribution: [],
        police_unit_distribution: [],
        weapon_type_distribution: [],
        drug_type_distribution: [],
      },
    ]);
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaService;
    const cache = createCacheMock();
    const service = new MapFeaturesQueryService(
      prisma,
      cache as unknown as RedisCacheService
    );

    await service.getCharts();
    await service.invalidateReadCache();
    await service.getCharts();

    expect(queryRawUnsafe).toHaveBeenCalledTimes(2);
    expect(cache.deleteByPrefix).toHaveBeenCalledWith('map-features:v2:');
  });

  it('does not write stale cache loads after invalidation', async () => {
    let resolveStaleQuery!: (
      value: Array<Record<string, unknown>>
    ) => void;
    const staleQuery = new Promise<Array<Record<string, unknown>>>((resolve) => {
      resolveStaleQuery = resolve;
    });
    const queryRawUnsafe = jest
      .fn()
      .mockReturnValueOnce(staleQuery)
      .mockResolvedValueOnce([
        {
          total_features: '4',
          total_records: '5',
          category_distribution: [],
          period_distribution: [],
          weekday_distribution: [],
          record_type_distribution: [],
          object_type_distribution: [],
          vehicle_brand_distribution: [],
          phone_brand_distribution: [],
          location_type_distribution: [],
          police_circumscription_distribution: [],
          police_unit_distribution: [],
          weapon_type_distribution: [],
          drug_type_distribution: [],
        },
      ]);
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaService;
    const cache = createCacheMock();
    const service = new MapFeaturesQueryService(
      prisma,
      cache as unknown as RedisCacheService
    );

    const staleLoad = service.getCharts();
    await Promise.resolve();
    await Promise.resolve();
    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);

    await service.invalidateReadCache();
    resolveStaleQuery([
      {
        total_features: '2',
        total_records: '3',
        category_distribution: [],
        period_distribution: [],
        weekday_distribution: [],
        record_type_distribution: [],
        object_type_distribution: [],
        vehicle_brand_distribution: [],
        phone_brand_distribution: [],
        location_type_distribution: [],
        police_circumscription_distribution: [],
        police_unit_distribution: [],
        weapon_type_distribution: [],
        drug_type_distribution: [],
      },
    ]);

    await expect(staleLoad).resolves.toMatchObject({
      totalFeatures: 2,
      totalRecords: 3,
    });
    expect(cache.setJson).not.toHaveBeenCalled();

    await expect(service.getCharts()).resolves.toMatchObject({
      totalFeatures: 4,
      totalRecords: 5,
    });
    expect(queryRawUnsafe).toHaveBeenCalledTimes(2);
    expect(cache.setJson).toHaveBeenCalledTimes(1);
  });

  it('hydrates missing detail records from raw source tables', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: '019eb505-9731-77d6-857f-56e4b1d9ccb7',
        num_bo: 'DU3509',
        ano_bo: 2026,
        delegacia: 'DEL.POL.METROPOLITANO',
        latitude: -23.551201,
        longitude: -46.634047,
        location_hash: 'f4693e770c96dabb',
        category: 'Roubo (art. 157)',
        rubrica_for_styling: 'Roubo (art. 157)',
        data_ocorrencia: new Date('2026-01-01T00:00:00.000Z'),
        source_tables: [
          'dados_criminais_2026',
          'objetos_2026',
          'celulares_2026',
        ],
        feature_data: {
          location: {},
          occurrence: {},
          all_rubricas: ['Roubo (art. 157)'],
          records: [
            {
              type: 'dados_criminais',
              source_id: 181952,
              source_table: 'dados_criminais_2026',
              rubrica: 'Roubo (art. 157)',
            },
          ],
          summary: {
            total_records: 1,
            celulares_count: 0,
            veiculos_count: 0,
            objetos_count: 0,
            dados_criminais_count: 1,
            produtividade_count: 0,
          },
        },
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    const queryRawUnsafe = jest.fn().mockImplementation((query: string) => {
      if (query.includes('raw"."objetos_2026')) {
        return Promise.resolve([
          {
            id: 285443,
            NUM_BO: 'DU3509',
            ANO_BO: 2026,
            NOME_DELEGACIA: 'DEL.POL.METROPOLITANO',
            LATITUDE: '-23.551201401',
            LONGITUDE: '-46.634046855',
            RUBRICA: 'Roubo (art. 157)',
            DESCR_TIPO_OBJETO: 'Documentos',
            DESCR_SUBTIPO_OBJETO: 'Cpf-Cadastro de Pessoas Físicas',
            QUANTIDADE_OBJETO: '1',
          },
        ]);
      }

      if (query.includes('raw"."celulares_2026')) {
        return Promise.resolve([
          {
            id: 55553,
            NUM_BO: 'DU3509',
            ANO_BO: 2026,
            NOME_DELEGACIA: 'DEL.POL.METROPOLITANO',
            LATITUDE: '-23.551201401',
            LONGITUDE: '-46.634046855',
            RUBRICA: 'Roubo (art. 157)',
            DESCR_TIPO_OBJETO: 'Telecomunicação',
            DESCR_SUBTIPO_OBJETO: 'Telefone Celular',
            MARCA_OBJETO: 'Samsung',
            QUANTIDADE_OBJETO: 1,
          },
          {
            id: 55554,
            NUM_BO: 'DU3509',
            ANO_BO: 2026,
            NOME_DELEGACIA: 'DEL.POL.METROPOLITANO',
            LATITUDE: '-23.551201401',
            LONGITUDE: '-46.634046855',
            RUBRICA: 'Roubo (art. 157)',
            DESCR_TIPO_OBJETO: 'Telecomunicação',
            DESCR_SUBTIPO_OBJETO: 'Telefone Celular',
            MARCA_OBJETO: 'Samsung',
            QUANTIDADE_OBJETO: 1,
          },
        ]);
      }

      return Promise.resolve([]);
    });
    const prisma = {
      mapFeature: { findMany },
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaService;
    const previousHydrationFlag =
      process.env.MAP_FEATURES_HYDRATE_MISSING_SOURCE_RECORDS;
    process.env.MAP_FEATURES_HYDRATE_MISSING_SOURCE_RECORDS = 'true';
    const service = new MapFeaturesQueryService(prisma);

    const [feature] = await service.getFeaturesByBo(
      'DU3509',
      2026,
      'DEL.POL.METROPOLITANO'
    );

    expect(feature.feature_data.records.map((record) => record.type)).toEqual([
      'dados_criminais',
      'objeto',
      'celular',
      'celular',
    ]);
    expect(feature.feature_data.summary).toMatchObject({
      total_records: 4,
      celulares_count: 2,
      objetos_count: 1,
      dados_criminais_count: 1,
    });

    if (previousHydrationFlag === undefined) {
      delete process.env.MAP_FEATURES_HYDRATE_MISSING_SOURCE_RECORDS;
    } else {
      process.env.MAP_FEATURES_HYDRATE_MISSING_SOURCE_RECORDS =
        previousHydrationFlag;
    }
  });

  it('returns an empty tile when Prisma cannot start the tile transaction in time', async () => {
    const transactionStartError = new Error(
      'Transaction API error: Unable to start a transaction in the given time.'
    );
    Object.setPrototypeOf(
      transactionStartError,
      Prisma.PrismaClientKnownRequestError.prototype
    );
    const transaction = jest.fn().mockRejectedValue(transactionStartError);
    const prisma = {
      $transaction: transaction,
    } as unknown as PrismaService;
    const service = new MapFeaturesQueryService(prisma);

    await expect(service.getTile({ z: 12, x: 100, y: 200 })).resolves.toEqual({
      status: 'timeout',
      tile: null,
    });
  });
});
