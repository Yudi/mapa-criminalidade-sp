import { PrismaService } from '../../prisma/prisma.service';
import {
  normalizedSourceNumberTextExpression,
  sourceTextExpression,
} from '../utils/source-sql.utils';
import { getSourceTableConfig } from '../config/source-tables.config';
import { MapFeaturesEtlService } from './map-features-etl.service';
import { MapFeaturesQueryService } from './map-features-query.service';
import {
  buildProcessableRowsWhere,
  buildRemoveSourceTableFeaturesSql,
} from './etl/map-features-etl-sql';

type SourceTableConfig = NonNullable<ReturnType<typeof getSourceTableConfig>>;

describe('MapFeaturesEtlService', () => {
  function createQueryServiceMock(): Pick<
    MapFeaturesQueryService,
    'invalidateReadCache'
  > {
    return {
      invalidateReadCache: jest.fn().mockResolvedValue(0),
    };
  }

  function createService(
    prisma: PrismaService = {} as PrismaService,
    queryService: Pick<MapFeaturesQueryService, 'invalidateReadCache'> =
      createQueryServiceMock()
  ): MapFeaturesEtlService {
    return new MapFeaturesEtlService(
      prisma,
      queryService as MapFeaturesQueryService
    );
  }

  function createValidator(): {
    hasValidSourceMetadata(row: {
      table_name: string;
      columns_json: unknown;
    }): boolean;
  } {
    return createService() as unknown as {
      hasValidSourceMetadata(row: {
        table_name: string;
        columns_json: unknown;
      }): boolean;
    };
  }

  it('accepts dynamic table metadata with source columns', () => {
    const service = createValidator();

    expect(
      service.hasValidSourceMetadata({
        table_name: 'dados_criminais_2026',
        columns_json: {
          columns: ['NUM_BO', 'ANO_BO'],
          types: {
            NUM_BO: 'TEXT',
            ANO_BO: 'TEXT',
          },
          logicalTypes: {
            ANO_BO: 'INT',
          },
        },
      })
    ).toBe(true);
  });

  it('rejects malformed dynamic table metadata', () => {
    const service = createValidator();

    expect(
      service.hasValidSourceMetadata({
        table_name: 'dados_criminais_2026',
        columns_json: {
          columns: [],
        },
      })
    ).toBe(false);
  });

  it('casts raw source columns to text before trimming them', () => {
    expect(sourceTextExpression('NUM_BO')).toContain(
      'btrim("NUM_BO"::text)'
    );
    expect(normalizedSourceNumberTextExpression('ANO_BO')).toContain(
      'btrim("ANO_BO"::text)'
    );
    expect(
      buildProcessableRowsWhere({
        columnMappings: {
          num_bo: 'NUM_BO',
          ano_bo: 'ANO_BO',
          latitude: 'LATITUDE',
          longitude: 'LONGITUDE',
        },
      } as SourceTableConfig)
    ).toContain('btrim("NUM_BO"::text)');
  });

  it('removes only refreshed source-table records from merged features', () => {
    const sql = buildRemoveSourceTableFeaturesSql();

    expect(sql).toContain('UPDATE map_features');
    expect(sql).toContain('array_remove(source_tables, $1)');
    expect(sql).toContain("record.value->>'source_table' <> $1");
    expect(sql).toContain('source_tables @> ARRAY[$1]::text[]');
    expect(sql).toContain('cardinality(source_tables) > 1');
    expect(sql).toContain("'celulares_count'");
    expect(sql).toContain("'objetos_count'");
    expect(sql).not.toContain('DELETE FROM map_features');
  });

  it('configures ETL transaction guardrails before running bulk writes', async () => {
    const executeRawUnsafe = jest.fn().mockResolvedValue(undefined);
    const transaction = jest
      .fn()
      .mockImplementation(async (operation) =>
        operation({ $executeRawUnsafe: executeRawUnsafe })
      );
    const service = createService({
      $transaction: transaction,
    } as unknown as PrismaService) as unknown as {
      runEtlTransaction<T>(
        operation: (tx: { $executeRawUnsafe: jest.Mock }) => Promise<T>
      ): Promise<T>;
    };

    await expect(
      service.runEtlTransaction(async () => 'processed')
    ).resolves.toBe('processed');

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 30_000,
      timeout: 3_900_000,
    });
    expect(executeRawUnsafe).toHaveBeenNthCalledWith(
      1,
      "SET LOCAL lock_timeout = '15000ms'"
    );
    expect(executeRawUnsafe).toHaveBeenNthCalledWith(
      2,
      "SET LOCAL statement_timeout = '600000ms'"
    );
    expect(executeRawUnsafe).toHaveBeenNthCalledWith(
      3,
      "SET LOCAL idle_in_transaction_session_timeout = '120000ms'"
    );
  });

  it('invalidates map feature read caches after refreshed source tables', async () => {
    const queryService = {
      invalidateReadCache: jest.fn().mockResolvedValue(3),
    };
    const service = createService(
      {} as PrismaService,
      queryService
    ) as unknown as {
      invalidateReadCacheIfNeeded(refreshedTables: number): Promise<void>;
    };

    await service.invalidateReadCacheIfNeeded(2);

    expect(queryService.invalidateReadCache).toHaveBeenCalledTimes(1);
  });
});
