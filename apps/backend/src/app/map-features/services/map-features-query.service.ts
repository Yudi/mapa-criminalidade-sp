import { createHash } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import type { MapFeature as PrismaMapFeature } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  qualifiedTableName,
  quoteIdentifier,
  quoteLiteral,
} from '../../prisma/sql.utils';
import { RedisCacheService } from '../../shared/cache/redis-cache.service';
import { isRequestTimeoutError } from '../../shared/error.utils';
import {
  MapFeature,
  MapFeatureCharts,
  MapFeatureData,
  ImlRecord,
  MapFeaturesCategoryStats,
  MapFeaturesCategoryPeriodStats,
  MapFeaturesFilterParams,
  MapFeaturesPeriodStats,
  MapFeatureSummaryRecord,
  MapFeaturesTileParams,
  SourceRecord,
} from '../types/map-features.types';
import { getSourceTableConfig } from '../config/source-tables.config';
const TILE_CONFIG = {
  MAX_CONCURRENT_TILES: getPositiveIntegerEnv(
    'MAP_FEATURES_MAX_CONCURRENT_TILES',
    2,
    1,
    16
  ),
  MAX_QUEUED_TILES: getPositiveIntegerEnv(
    'MAP_FEATURES_MAX_QUEUED_TILES',
    512,
    0,
    10_000
  ),
  QUEUE_TIMEOUT_MS: getPositiveIntegerEnv(
    'MAP_FEATURES_TILE_QUEUE_TIMEOUT_MS',
    30_000,
    1_000,
    120_000
  ),
  STATEMENT_TIMEOUT_MS: getPositiveIntegerEnv(
    'MAP_FEATURES_TILE_STATEMENT_TIMEOUT_MS',
    30_000,
    5_000,
    120_000
  ),
  TRANSACTION_MAX_WAIT_MS: getPositiveIntegerEnv(
    'MAP_FEATURES_TILE_TRANSACTION_MAX_WAIT_MS',
    30_000,
    1_000,
    120_000
  ),
} as const;

export const MAP_FEATURES_CACHE_KEY_PREFIX = 'map-features:v2';
const CACHE_TTL_SECONDS = {
  CHARTS: 10 * 60,
  FILTERED_STATS: 5 * 60,
  GLOBAL_METADATA: 30 * 60,
} as const;

const PERIOD_SQL = `NULLIF(periodo_normalized, '')`;
const PERIOD_KEY_SQL = PERIOD_SQL;
const PERIOD_LABEL_SQL = `
  CASE ${PERIOD_KEY_SQL}
    WHEN 'de madrugada' THEN 'De madrugada'
    WHEN 'pela manha' THEN 'Pela manhã'
    WHEN 'a tarde' THEN 'À tarde'
    WHEN 'a noite' THEN 'À noite'
    WHEN 'em hora incerta' THEN 'Em hora incerta'
    ELSE upper(substring(${PERIOD_KEY_SQL} from 1 for 1)) || substring(${PERIOD_KEY_SQL} from 2)
  END
`;
const PERIOD_SORT_SQL = `
  CASE ${PERIOD_KEY_SQL}
    WHEN 'de madrugada' THEN 1
    WHEN 'pela manha' THEN 2
    WHEN 'a tarde' THEN 3
    WHEN 'a noite' THEN 4
    WHEN 'em hora incerta' THEN 5
    ELSE 99
  END
`;
const OCCURRENCE_HOUR_SQL = `hora_ocorrencia`;
const TOP_CHART_BUCKET_LIMIT = 12;
const RECORD_QUANTITY_SQL = `
  CASE
    WHEN record.value->>'quantidade' ~ '^[0-9]+$'
    THEN (record.value->>'quantidade')::int
    ELSE 1
  END
`;
const DRUG_GRAMS_SQL = `
  CASE
    WHEN record.value->>'quantidade_gramas' ~ '^[0-9]+([.,][0-9]+)?$'
    THEN replace(record.value->>'quantidade_gramas', ',', '.')::numeric
    ELSE 0
  END
`;

type SqlParam = string | number;

type SqlFilterOptions = {
  includeCategories?: boolean;
  includePeriods?: boolean;
  includeBounds?: boolean;
  includeHours?: boolean;
};

type MapFeaturesBoundsFilter = MapFeaturesFilterParams &
  Required<
    Pick<MapFeaturesFilterParams, 'minLon' | 'minLat' | 'maxLon' | 'maxLat'>
  >;
type ChartBucketRow = {
  label: string | null;
  count: bigint | string | number;
  amount?: string | number | null;
};
type ChartsQueryRow = {
  total_features: bigint | string | number;
  total_records: bigint | string | number;
  category_distribution: unknown;
  period_distribution: unknown;
  weekday_distribution: unknown;
  record_type_distribution: unknown;
  object_type_distribution: unknown;
  vehicle_brand_distribution: unknown;
  phone_brand_distribution: unknown;
  location_type_distribution: unknown;
  police_circumscription_distribution: unknown;
  police_unit_distribution: unknown;
  weapon_type_distribution: unknown;
  drug_type_distribution: unknown;
};
type RawTileBuffer = Buffer | Uint8Array | ArrayBuffer | number[];
type TileQueryRow = { mvt: RawTileBuffer | null };
type CategoryPeriodStatsQueryRow = {
  categories: unknown;
  periods: unknown;
};
export type MapFeatureTileResult =
  | { status: 'ok'; tile: Buffer }
  | { status: 'empty'; tile: null }
  | { status: 'timeout'; tile: null };
type SemaphoreQueueEntry = {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
};

function getPositiveIntegerEnv(
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min) {
    return fallback;
  }

  return Math.min(value, max);
}

class Semaphore {
  private running = 0;
  private queue: SemaphoreQueueEntry[] = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueued: number,
    private readonly queueTimeoutMs: number
  ) {}

  async acquire(): Promise<() => void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return () => this.release();
    }

    if (this.queue.length >= this.maxQueued) {
      throw new Error('Tile queue is full');
    }

    return new Promise<() => void>((resolve, reject) => {
      const entry: SemaphoreQueueEntry = {
        resolve,
        reject,
        timeoutHandle: setTimeout(() => {
          this.queue = this.queue.filter((item) => item !== entry);
          reject(new Error('Tile queue wait timed out'));
        }, this.queueTimeoutMs),
      };
      this.queue.push(entry);
    });
  }

  release(): void {
    this.running = Math.max(0, this.running - 1);
    const next = this.queue.shift();
    if (next) {
      clearTimeout(next.timeoutHandle);
      this.running++;
      next.resolve(() => this.release());
    }
  }
}
@Injectable()
export class MapFeaturesQueryService {
  private readonly logger = new Logger(MapFeaturesQueryService.name);
  private readonly hydrateMissingSourceRecordsEnabled =
    process.env.MAP_FEATURES_HYDRATE_MISSING_SOURCE_RECORDS === 'true';
  private readonly tileSemaphore = new Semaphore(
    TILE_CONFIG.MAX_CONCURRENT_TILES,
    TILE_CONFIG.MAX_QUEUED_TILES,
    TILE_CONFIG.QUEUE_TIMEOUT_MS
  );
  private readonly inFlightCacheLoads = new Map<string, Promise<unknown>>();
  private cacheInvalidationGeneration = 0;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly cache?: RedisCacheService
  ) {}
  async getTile(params: MapFeaturesTileParams): Promise<MapFeatureTileResult> {
    let releaseTileSlot: (() => void) | undefined;

    try {
      releaseTileSlot = await this.tileSemaphore.acquire();
    } catch (error) {
      this.logger.warn(`Tile request rejected before query: ${error}`);
      return { status: 'timeout', tile: null };
    }

    try {
      return await this.generateTileWithTimeout(params);
    } finally {
      releaseTileSlot();
    }
  }

  async invalidateReadCache(): Promise<void> {
    this.cacheInvalidationGeneration++;
    this.inFlightCacheLoads.clear();
    await this.cache?.deleteByPrefix(`${MAP_FEATURES_CACHE_KEY_PREFIX}:`);
  }
  private async generateTileWithTimeout(
    params: MapFeaturesTileParams
  ): Promise<MapFeatureTileResult> {
    const { z, x, y } = params;
    const queryParams: SqlParam[] = [
      z,
      x,
      y,
      JSON.stringify({
        before: this.normalizeOptionalString(params.beforeDate),
        after: this.normalizeOptionalString(params.afterDate),
        categories: this.normalizeStringList(params.categories)?.join(','),
        periods: this.normalizeStringList(params.periods)?.join(','),
        startHour: params.startHour,
        endHour: params.endHour,
      }),
    ];
    const mvtQuery = `
      SELECT public.occurrences($1, $2, $3, $4::json) AS mvt
    `;

    try {
      this.logger.debug(`Generating tile z=${z} x=${x} y=${y}`);
      const result = await this.runTileQuery(mvtQuery, queryParams);

      if (!result || result.length === 0 || !result[0]?.mvt) {
        return { status: 'empty', tile: null };
      }

      const mvtBuffer = this.normalizeTileBuffer(result[0].mvt);
      this.logger.debug(
        `Tile z=${z} x=${x} y=${y} generated: ${mvtBuffer.length} bytes`
      );
      return { status: 'ok', tile: mvtBuffer };
    } catch (error) {
      if (isRequestTimeoutError(error)) {
        this.logger.warn(
          `Tile z=${z} x=${x} y=${y} timed out after ${TILE_CONFIG.STATEMENT_TIMEOUT_MS}ms`
        );
        return { status: 'timeout', tile: null };
      }

      this.logger.error(`Error generating tile: ${error}`);
      throw error;
    }
  }

  private async runTileQuery(
    mvtQuery: string,
    queryParams: SqlParam[]
  ): Promise<TileQueryRow[]> {
    return await this.prisma.$transaction(
      async (tx) => {
        await this.configureTileTransaction(tx);

        return await tx.$queryRawUnsafe<TileQueryRow[]>(
          mvtQuery,
          ...queryParams
        );
      },
      {
        maxWait: TILE_CONFIG.TRANSACTION_MAX_WAIT_MS,
        timeout: TILE_CONFIG.STATEMENT_TIMEOUT_MS + 1000,
      }
    );
  }

  private async configureTileTransaction(
    tx: Prisma.TransactionClient
  ): Promise<void> {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe(
      `SET LOCAL statement_timeout = '${TILE_CONFIG.STATEMENT_TIMEOUT_MS}ms'`
    );
    await tx.$executeRawUnsafe('SET LOCAL plan_cache_mode = force_custom_plan');
    await tx.$executeRawUnsafe("SET LOCAL work_mem = '32MB'");
  }

  private normalizeTileBuffer(value: RawTileBuffer): Buffer {
    if (Buffer.isBuffer(value)) {
      return value;
    }

    if (value instanceof ArrayBuffer) {
      return Buffer.from(value);
    }

    return Buffer.from(value);
  }
  async getCategories(params?: {
    beforeDate?: string;
    afterDate?: string;
    categories?: string[];
    periods?: string[];
    startHour?: number;
    endHour?: number;
    minLon?: number;
    minLat?: number;
    maxLon?: number;
    maxLat?: number;
  }): Promise<MapFeaturesCategoryStats[]> {
    return await this.getCachedJson(
      'categories',
      this.normalizeFilterParams(params),
      this.getStatsCacheTtl(params),
      async () => {
        const conditions: string[] = ['geom IS NOT NULL'];
        const queryParams: SqlParam[] = [];
        this.appendSqlFilters(conditions, queryParams, 1, params);
        const whereClause = conditions.join(' AND ');

        const query = `
          SELECT
            category_bucket.category_name as category,
            COUNT(*) as count,
            COALESCE(
              MAX(
                CASE
                  WHEN category_bucket.category_name = map_features.category
                  THEN map_features.rubrica_for_styling
                  ELSE NULL
                END
              ),
              category_bucket.category_name
            ) as rubrica_for_styling,
            BOOL_OR(
              category_bucket.category_name = ANY(map_features.all_rubricas)
            ) as is_rubrica
          FROM map_features
          ${this.buildCategoryBucketLateralSql('map_features')}
          WHERE ${whereClause}
          GROUP BY category_bucket.category_name
          ORDER BY count DESC
        `;

        const results = await this.prisma.$queryRawUnsafe<
          {
            category: string;
            count: bigint | string;
            rubrica_for_styling: string | null;
            is_rubrica: boolean | null;
          }[]
        >(query, ...queryParams);

        return results.map((row) => ({
          name: row.category,
          count: Number(row.count),
          rubricaForStyling: row.rubrica_for_styling ?? row.category,
          sourceType: row.is_rubrica
            ? ('rubrica' as const)
            : ('derived' as const),
        }));
      }
    );
  }
  async getCategoriesForLocation(
    longitude: number,
    latitude: number,
    radius: number,
    beforeDate?: string,
    afterDate?: string,
    periods?: string[],
    startHour?: number,
    endHour?: number
  ): Promise<MapFeaturesCategoryStats[]> {
    return await this.getCachedJson(
      'categories-location',
      {
        longitude,
        latitude,
        radius,
        ...this.normalizeFilterParams({
          beforeDate,
          afterDate,
          periods,
          startHour,
          endHour,
        }),
      },
      CACHE_TTL_SECONDS.FILTERED_STATS,
      async () => {
        const conditions: string[] = ['geom IS NOT NULL'];
        const queryParams: SqlParam[] = [longitude, latitude, radius];
        const paramIndex = 4;

        conditions.push(
          `geom && ST_Expand(ST_SetSRID(ST_MakePoint($1, $2), 4326), $3 / 111320.0)`
        );
        conditions.push(
          `ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`
        );

        this.appendSqlFilters(conditions, queryParams, paramIndex, {
          beforeDate,
          afterDate,
          periods,
          startHour,
          endHour,
        });

        const whereClause = conditions.join(' AND ');

        const query = `
          SELECT
            category_bucket.category_name as category,
            COUNT(*) as count,
            COALESCE(
              MAX(
                CASE
                  WHEN category_bucket.category_name = map_features.category
                  THEN map_features.rubrica_for_styling
                  ELSE NULL
                END
              ),
              category_bucket.category_name
            ) as rubrica_for_styling,
            BOOL_OR(
              category_bucket.category_name = ANY(map_features.all_rubricas)
            ) as is_rubrica
          FROM map_features
          ${this.buildCategoryBucketLateralSql('map_features')}
          WHERE ${whereClause}
          GROUP BY category_bucket.category_name
          ORDER BY count DESC
        `;

        const results = await this.prisma.$queryRawUnsafe<
          {
            category: string;
            count: bigint | string;
            rubrica_for_styling: string | null;
            is_rubrica: boolean | null;
          }[]
        >(query, ...queryParams);

        return results.map((row) => ({
          name: row.category,
          count: Number(row.count),
          rubricaForStyling: row.rubrica_for_styling ?? row.category,
          sourceType: row.is_rubrica
            ? ('rubrica' as const)
            : ('derived' as const),
        }));
      }
    );
  }
  async getPeriods(
    params?: MapFeaturesFilterParams
  ): Promise<MapFeaturesPeriodStats[]> {
    return await this.getCachedJson(
      'periods',
      this.normalizeFilterParams(params),
      this.getStatsCacheTtl(params),
      async () => {
        const conditions: string[] = [
          'geom IS NOT NULL',
          `${PERIOD_SQL} IS NOT NULL`,
        ];
        const queryParams: SqlParam[] = [];
        this.appendSqlFilters(conditions, queryParams, 1, params, {
          includePeriods: false,
        });

        const query = `
          SELECT
            ${PERIOD_LABEL_SQL} as name,
            COUNT(*) as count,
            ${PERIOD_SORT_SQL} as sort_order
          FROM map_features
          WHERE ${conditions.join(' AND ')}
          GROUP BY ${PERIOD_KEY_SQL}, ${PERIOD_LABEL_SQL}, ${PERIOD_SORT_SQL}
          ORDER BY sort_order ASC, name ASC
        `;

        const results = await this.prisma.$queryRawUnsafe<
          { name: string; count: bigint | string }[]
        >(query, ...queryParams);

        return results.map((row) => ({
          name: row.name,
          count: Number(row.count),
        }));
      }
    );
  }
  async getCategoryPeriodStats(
    params?: MapFeaturesFilterParams
  ): Promise<MapFeaturesCategoryPeriodStats> {
    return await this.getCachedJson(
      'category-period-stats',
      this.normalizeFilterParams(params),
      this.getStatsCacheTtl(params),
      async () => {
        const baseConditions: string[] = ['geom IS NOT NULL'];
        const queryParams: SqlParam[] = [];
        let paramIndex = this.appendSqlFilters(
          baseConditions,
          queryParams,
          1,
          params,
          { includePeriods: false }
        );
        const categoryConditions: string[] = [];
        const periods = this.normalizeStringList(params?.periods);

        if (periods?.length) {
          const placeholders = periods
            .map(() => `$${paramIndex++}`)
            .join(', ');
          categoryConditions.push(`${PERIOD_KEY_SQL} IN (${placeholders})`);
          queryParams.push(
            ...periods.map((period) => this.normalizePeriodKey(period))
          );
        }

        const [row] = await this.prisma.$queryRawUnsafe<
          CategoryPeriodStatsQueryRow[]
        >(
          `
            WITH visible_features AS MATERIALIZED (
              SELECT
                category,
                rubrica_for_styling,
                all_rubricas,
                periodo_normalized
              FROM map_features
              WHERE ${baseConditions.join(' AND ')}
            )
            SELECT
              (
                SELECT COALESCE(
                  jsonb_agg(to_jsonb(category_rows) ORDER BY count DESC, category ASC),
                  '[]'::jsonb
                )
                FROM (
                  SELECT
                    category_bucket.category_name AS category,
                    COUNT(*) AS count,
                    COALESCE(
                      MAX(
                        CASE
                          WHEN category_bucket.category_name = visible_features.category
                          THEN visible_features.rubrica_for_styling
                        END
                      ),
                      category_bucket.category_name
                    ) AS rubrica_for_styling,
                    BOOL_OR(
                      category_bucket.category_name = ANY(visible_features.all_rubricas)
                    ) AS is_rubrica
                  FROM visible_features
                  ${this.buildCategoryBucketLateralSql('visible_features')}
                  ${
                    categoryConditions.length
                      ? `WHERE ${categoryConditions.join(' AND ')}`
                      : ''
                  }
                  GROUP BY category_bucket.category_name
                ) category_rows
              ) AS categories,
              (
                SELECT COALESCE(
                  jsonb_agg(to_jsonb(period_rows) ORDER BY sort_order ASC, name ASC),
                  '[]'::jsonb
                )
                FROM (
                  SELECT
                    ${PERIOD_LABEL_SQL} AS name,
                    COUNT(*) AS count,
                    ${PERIOD_SORT_SQL} AS sort_order
                  FROM visible_features
                  WHERE ${PERIOD_SQL} IS NOT NULL
                  GROUP BY ${PERIOD_KEY_SQL}, ${PERIOD_LABEL_SQL}, ${PERIOD_SORT_SQL}
                ) period_rows
              ) AS periods
          `,
          ...queryParams
        );

        return {
          categories: this.toCategoryStatsFromJson(row?.categories),
          periods: this.toPeriodStatsFromJson(row?.periods),
        };
      }
    );
  }
  async getCharts(params?: MapFeaturesFilterParams): Promise<MapFeatureCharts> {
    return await this.getCachedJson(
      'charts',
      this.normalizeFilterParams(params),
      CACHE_TTL_SECONDS.CHARTS,
      async () => {
        const conditions: string[] = ['geom IS NOT NULL'];
        const queryParams: SqlParam[] = [];
        this.appendSqlFilters(conditions, queryParams, 1, params);
        const whereClause = conditions.join(' AND ');

        const [charts] = await this.prisma.$queryRawUnsafe<ChartsQueryRow[]>(
          this.buildChartsQuery(whereClause),
          ...queryParams
        );

        return {
          totalFeatures: Number(charts?.total_features ?? 0),
          totalRecords: Number(charts?.total_records ?? 0),
          categoryDistribution: this.toChartBucketsFromJson(
            charts?.category_distribution
          ),
          periodDistribution: this.toChartBucketsFromJson(
            charts?.period_distribution
          ),
          weekdayDistribution: this.toChartBucketsFromJson(
            charts?.weekday_distribution
          ),
          recordTypeDistribution: this.toChartBucketsFromJson(
            charts?.record_type_distribution
          ),
          objectTypeDistribution: this.toChartBucketsFromJson(
            charts?.object_type_distribution
          ),
          vehicleBrandDistribution: this.toChartBucketsFromJson(
            charts?.vehicle_brand_distribution
          ),
          phoneBrandDistribution: this.toChartBucketsFromJson(
            charts?.phone_brand_distribution
          ),
          locationTypeDistribution: this.toChartBucketsFromJson(
            charts?.location_type_distribution
          ),
          policeCircumscriptionDistribution: this.toChartBucketsFromJson(
            charts?.police_circumscription_distribution
          ),
          policeUnitDistribution: this.toChartBucketsFromJson(
            charts?.police_unit_distribution
          ),
          weaponTypeDistribution: this.toChartBucketsFromJson(
            charts?.weapon_type_distribution
          ),
          drugTypeDistribution: this.toChartBucketsFromJson(
            charts?.drug_type_distribution
          ),
        };
      }
    );
  }
  /** Uses the registration police unit to disambiguate pre-2022 BO numbers. */
  async getFeaturesByBo(
    numBo: string,
    anoBo?: number,
    delegacia?: string
  ): Promise<MapFeature[]> {
    const where = this.buildBoWhere(numBo, anoBo, delegacia);

    const results = await this.prisma.mapFeature.findMany({
      where,
      orderBy: { data_ocorrencia: 'desc' },
    });

    return await Promise.all(
      results.map((row) =>
        this.hydrateMissingSourceRecords(this.mapPrismaFeature(row))
      )
    );
  }
  async getFeatureSummariesByBo(
    numBo: string,
    anoBo?: number,
    delegacia?: string | null
  ): Promise<MapFeatureSummaryRecord[]> {
    const where = this.buildBoWhere(numBo, anoBo, delegacia ?? undefined);

    const results = await this.prisma.mapFeature.findMany({
      where,
      orderBy: { data_ocorrencia: 'desc' },
      select: {
        id: true,
        num_bo: true,
        ano_bo: true,
        delegacia: true,
        latitude: true,
        longitude: true,
        category: true,
        rubrica_for_styling: true,
        data_ocorrencia: true,
        source_tables: true,
      },
    });

    return results.map((row) => ({
      id: row.id,
      num_bo: row.num_bo,
      ano_bo: row.ano_bo,
      delegacia: row.delegacia ?? null,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      category: row.category,
      rubrica_for_styling: row.rubrica_for_styling,
      data_ocorrencia: row.data_ocorrencia,
      source_tables: row.source_tables,
    }));
  }
  async getFeatureByBo(
    numBo: string,
    anoBo?: number,
    delegacia?: string | null
  ): Promise<MapFeature | null> {
    const [feature] = await this.getFeaturesByBo(
      numBo,
      anoBo,
      delegacia ?? undefined
    );
    return feature ?? null;
  }
  async getFeatureById(id: string): Promise<MapFeature | null> {
    const row = await this.prisma.mapFeature.findUnique({
      where: { id },
    });

    return row
      ? await this.hydrateMissingSourceRecords(this.mapPrismaFeature(row))
      : null;
  }
  async getImlRecordsByBo(
    numBo: string,
    anoBo: number,
    delegacia: string | null
  ): Promise<ImlRecord[]> {
    if (!delegacia) {
      return [];
    }

    const tables = await this.prisma.$queryRaw<{ table_name: string }[]>(
      Prisma.sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'raw'
          AND table_name LIKE 'registro_obitos_iml_%'
        ORDER BY table_name
      `
    );
    const tableNames = tables
      .map((row) => row.table_name)
      .filter((tableName) => /^registro_obitos_iml_\d{4}$/.test(tableName));

    if (tableNames.length === 0) {
      return [];
    }

    const selects = tableNames.map(
      (tableName) => `
        SELECT
          id AS source_id,
          ${quoteLiteral(tableName)} AS source_table,
          ${quoteIdentifier('DATA_ENTRADA_IML')} AS data_entrada_iml,
          ${quoteIdentifier('ANO_BO')} AS ano_bo,
          ${quoteIdentifier('NUM_BO')} AS num_bo,
          ${quoteIdentifier('DELEGACIA_REGISTRO')} AS delegacia_registro,
          ${quoteIdentifier('NUMERO_LAUDO')} AS numero_laudo,
          ${quoteIdentifier('ANO_LAUDO')} AS ano_laudo,
          ${quoteIdentifier('IDADE_VITIMA')} AS idade_vitima,
          ${quoteIdentifier('TIPO_IDADE')} AS tipo_idade,
          ${quoteIdentifier('CONCLUSAO')} AS conclusao,
          ${quoteIdentifier('DECLARACAO_OBITO')} AS declaracao_obito,
          ${quoteIdentifier('CAUSA_MORTIS')} AS causa_mortis
        FROM ${qualifiedTableName(tableName)}
        WHERE ${quoteIdentifier('NUM_BO_NORMALIZED')} = $1
          AND ${quoteIdentifier('ANO_BO')} = $2
          AND ${quoteIdentifier('DELEGACIA_REGISTRO_NORMALIZED')} = $3
      `
    );
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        source_id: number;
        source_table: string;
        data_entrada_iml: string | null;
        ano_bo: string | null;
        num_bo: string | null;
        delegacia_registro: string | null;
        numero_laudo: string | null;
        ano_laudo: string | null;
        idade_vitima: string | null;
        tipo_idade: string | null;
        conclusao: string | null;
        declaracao_obito: string | null;
        causa_mortis: string | null;
      }>
    >(
      `SELECT * FROM (${selects.join(
        ' UNION ALL '
      )}) AS iml_records
      ORDER BY
        CASE
          WHEN data_entrada_iml ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2}$'
            THEN to_timestamp(data_entrada_iml, 'DD/MM/YYYY HH24:MI:SS')
          WHEN data_entrada_iml ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4} [0-9]{2}:[0-9]{2}$'
            THEN to_timestamp(data_entrada_iml, 'DD/MM/YYYY HH24:MI')
          WHEN data_entrada_iml ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
            THEN to_timestamp(data_entrada_iml, 'DD/MM/YYYY')
          ELSE NULL
        END NULLS LAST,
        source_table,
        source_id`,
      this.normalizeImlLookupValue(numBo),
      String(anoBo),
      this.normalizeImlLookupValue(delegacia)
    );

    return rows.map((row) => ({
      sourceId: Number(row.source_id),
      sourceTable: row.source_table,
      dataEntradaIml: row.data_entrada_iml,
      anoBo: row.ano_bo,
      numBo: row.num_bo,
      delegaciaRegistro: row.delegacia_registro,
      numeroLaudo: row.numero_laudo,
      anoLaudo: row.ano_laudo,
      idadeVitima: row.idade_vitima,
      tipoIdade: row.tipo_idade,
      conclusao: row.conclusao,
      declaracaoObito: row.declaracao_obito,
      causaMortis: row.causa_mortis,
    }));
  }
  async getDateRange(): Promise<{
    earliest: string | null;
    latest: string | null;
    defaultAfter: string | null;
  }> {
    const result = await this.prisma.mapFeaturesDateRange.findUnique({
      where: { id: 1 },
      select: {
        earliest_date: true,
        latest_date: true,
        default_after_date: true,
      },
    });

    return {
      earliest: this.formatDateOnly(result?.earliest_date ?? null),
      latest: this.formatDateOnly(result?.latest_date ?? null),
      defaultAfter: this.formatDateOnly(result?.default_after_date ?? null),
    };
  }
  async getCount(params?: {
    beforeDate?: string;
    afterDate?: string;
    categories?: string[];
    periods?: string[];
    startHour?: number;
    endHour?: number;
    minLon?: number;
    minLat?: number;
    maxLon?: number;
    maxLat?: number;
  }): Promise<number> {
    return await this.getCachedJson(
      'count',
      this.normalizeFilterParams(params),
      this.getStatsCacheTtl(params),
      async () => {
        if (
          (params?.minLon !== undefined &&
            params?.minLat !== undefined &&
            params?.maxLon !== undefined &&
            params?.maxLat !== undefined) ||
          Boolean(params?.periods?.length) ||
          params?.startHour !== undefined ||
          params?.endHour !== undefined ||
          Boolean(params?.categories?.length)
        ) {
          const conditions: string[] = ['geom IS NOT NULL'];
          const queryParams: SqlParam[] = [];
          this.appendSqlFilters(conditions, queryParams, 1, params);

          const [result] = await this.prisma.$queryRawUnsafe<
            { count: bigint | string }[]
          >(
            `SELECT COUNT(*) as count FROM map_features WHERE ${conditions.join(
              ' AND '
            )}`,
            ...queryParams
          );

          return Number(result?.count ?? 0);
        }

        const where = this.buildDateWhere(params);

        return await this.prisma.mapFeature.count({ where });
      }
    );
  }
  async getEtlStatus(): Promise<
    Array<{
      source_table: string;
      status: string;
      rows_processed: number;
      last_etl_at: Date | null;
      error_message: string | null;
    }>
  > {
    return await this.prisma.mapFeaturesEtlStatus.findMany({
      select: {
        source_table: true,
        status: true,
        rows_processed: true,
        last_etl_at: true,
        error_message: true,
      },
      orderBy: { source_table: 'asc' },
    });
  }

  private async getCachedJson<T>(
    scope: string,
    payload: unknown,
    ttlSeconds: number,
    load: () => Promise<T>
  ): Promise<T> {
    if (!this.cache) return await load();

    const key = this.buildCacheKey(scope, payload);
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

  private buildCacheKey(scope: string, payload: unknown): string {
    const serializedPayload = JSON.stringify(this.normalizeCachePayload(payload));
    const digest = createHash('sha256')
      .update(serializedPayload)
      .digest('base64url');

    return `${MAP_FEATURES_CACHE_KEY_PREFIX}:${scope}:${digest}`;
  }

  private normalizeCachePayload(value: unknown): unknown {
    if (Array.isArray(value)) {
      const normalizedItems = value.map((item) =>
        this.normalizeCachePayload(item)
      );

      if (
        normalizedItems.every(
          (item) =>
            item === null ||
            ['boolean', 'number', 'string'].includes(typeof item)
        )
      ) {
        return normalizedItems.sort((left, right) =>
          String(left).localeCompare(String(right))
        );
      }

      return normalizedItems;
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    return Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined && item !== null && item !== '')
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .reduce<Record<string, unknown>>((payload, [key, item]) => {
        payload[key] = this.normalizeCachePayload(item);
        return payload;
      }, {});
  }

  private normalizeFilterParams(
    params?: MapFeaturesFilterParams
  ): MapFeaturesFilterParams {
    return {
      beforeDate: this.normalizeOptionalString(params?.beforeDate),
      afterDate: this.normalizeOptionalString(params?.afterDate),
      categories: this.normalizeStringList(params?.categories),
      periods: this.normalizeStringList(params?.periods),
      startHour: params?.startHour,
      endHour: params?.endHour,
      minLon: params?.minLon,
      minLat: params?.minLat,
      maxLon: params?.maxLon,
      maxLat: params?.maxLat,
    };
  }

  private normalizeOptionalString(value?: string): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  }

  private normalizeStringList(values?: string[]): string[] | undefined {
    const normalized = values
      ?.map((value) => value.trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));

    return normalized?.length ? normalized : undefined;
  }

  private getStatsCacheTtl(params?: MapFeaturesFilterParams): number {
    const normalized = this.normalizeCachePayload(
      this.normalizeFilterParams(params)
    );
    const hasFilters =
      normalized !== null &&
      typeof normalized === 'object' &&
      Object.keys(normalized).length > 0;

    return hasFilters
      ? CACHE_TTL_SECONDS.FILTERED_STATS
      : CACHE_TTL_SECONDS.GLOBAL_METADATA;
  }

  private buildChartsQuery(whereClause: string): string {
    const chartJson = (selectSql: string, orderSql = 'count DESC, label ASC') => `
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'label', label,
            'count', count,
            'amount', amount
          )
          ORDER BY ${orderSql}
        ),
        '[]'::jsonb
      )
      FROM (
        ${selectSql}
      ) chart_rows
    `;

    const topChartJson = (selectSql: string) =>
      chartJson(`
        SELECT *
        FROM (
          ${selectSql}
        ) chart_data
        WHERE label IS NOT NULL
        ORDER BY count DESC, label ASC
        LIMIT ${TOP_CHART_BUCKET_LIMIT}
      `);

    return `
      WITH visible_features AS MATERIALIZED (
        SELECT
          category,
          all_rubricas,
          periodo_normalized,
          data_ocorrencia,
          total_records,
          delegacia,
          feature_data->'records' AS records,
          feature_data->'location'->>'tipo_local' AS location_type,
          feature_data->'occurrence'->>'delegacia_circunscricao' AS police_circumscription
        FROM map_features
        WHERE ${whereClause}
      ),
      visible_records AS MATERIALIZED (
        SELECT record.value
        FROM visible_features
        CROSS JOIN LATERAL jsonb_array_elements(
          COALESCE(records, '[]'::jsonb)
        ) record(value)
      )
      SELECT
        (SELECT COUNT(*) FROM visible_features) as total_features,
        (SELECT COALESCE(SUM(total_records), 0) FROM visible_features) as total_records,
        (${chartJson(`
          SELECT category_bucket.category_name as label, COUNT(*) as count, NULL::numeric as amount
          FROM visible_features
          ${this.buildCategoryBucketLateralSql('visible_features')}
          GROUP BY category_bucket.category_name
          ORDER BY count DESC, label ASC
          LIMIT ${TOP_CHART_BUCKET_LIMIT}
        `)}) as category_distribution,
        (${chartJson(
          `
            SELECT
              COALESCE(${PERIOD_LABEL_SQL}, 'Não informado') as label,
              COUNT(*) as count,
              NULL::numeric as amount,
              ${PERIOD_SORT_SQL} as sort_order
            FROM visible_features
            GROUP BY ${PERIOD_KEY_SQL}, ${PERIOD_LABEL_SQL}, ${PERIOD_SORT_SQL}
            ORDER BY sort_order ASC, label ASC
            LIMIT ${TOP_CHART_BUCKET_LIMIT}
          `,
          'sort_order ASC, label ASC'
        )}) as period_distribution,
        (${chartJson(
          `
            SELECT
              CASE EXTRACT(ISODOW FROM data_ocorrencia)::int
                WHEN 1 THEN 'Segunda'
                WHEN 2 THEN 'Terça'
                WHEN 3 THEN 'Quarta'
                WHEN 4 THEN 'Quinta'
                WHEN 5 THEN 'Sexta'
                WHEN 6 THEN 'Sábado'
                WHEN 7 THEN 'Domingo'
                ELSE 'Não informado'
              END as label,
              COUNT(*) as count,
              NULL::numeric as amount,
              COALESCE(EXTRACT(ISODOW FROM data_ocorrencia)::int, 8) as sort_order
            FROM visible_features
            GROUP BY label, sort_order
            ORDER BY sort_order ASC
          `,
          'sort_order ASC, label ASC'
        )}) as weekday_distribution,
        (${topChartJson(`
          SELECT
            CASE record.value->>'type'
              WHEN 'celular' THEN 'Celulares'
              WHEN 'veiculo' THEN 'Veículos'
              WHEN 'objeto' THEN 'Objetos'
              WHEN 'dados_criminais' THEN 'Dados criminais'
              WHEN 'produtividade_armas' THEN 'Armas'
              WHEN 'produtividade_entorpecentes' THEN 'Entorpecentes'
              WHEN 'produtividade_veiculos' THEN 'Veículos recuperados'
              WHEN 'produtividade_pessoa' THEN 'Pessoas'
              ELSE COALESCE(NULLIF(record.value->>'type', ''), 'Não informado')
            END as label,
            COUNT(*) as count,
            NULL::numeric as amount
          FROM visible_records record
          GROUP BY label
        `)}) as record_type_distribution,
        (${topChartJson(`
          SELECT
            COALESCE(
              NULLIF(record.value->>'descr_tipo_objeto', ''),
              NULLIF(record.value->>'descr_subtipo_objeto', ''),
              'Não informado'
            ) as label,
            COUNT(*) as count,
            SUM(${RECORD_QUANTITY_SQL}) as amount
          FROM visible_records record
          WHERE record.value->>'type' IN ('objeto', 'celular')
          GROUP BY label
        `)}) as object_type_distribution,
        (${topChartJson(`
          SELECT
            concat_ws(
              ' · ',
              COALESCE(NULLIF(record.value->>'marca', ''), 'Marca não informada'),
              NULLIF(record.value->>'tipo_veiculo', ''),
              NULLIF(record.value->>'ano_modelo', '')
            ) as label,
            COUNT(*) as count,
            NULL::numeric as amount
          FROM visible_records record
          WHERE record.value->>'type' IN ('veiculo', 'produtividade_veiculos')
          GROUP BY label
        `)}) as vehicle_brand_distribution,
        (${topChartJson(`
          SELECT
            concat_ws(
              ' · ',
              COALESCE(NULLIF(record.value->>'marca', ''), 'Marca não informada'),
              NULLIF(record.value->>'descr_subtipo_objeto', '')
            ) as label,
            COUNT(*) as count,
            SUM(${RECORD_QUANTITY_SQL}) as amount
          FROM visible_records record
          WHERE record.value->>'type' = 'celular'
          GROUP BY label
        `)}) as phone_brand_distribution,
        (${topChartJson(`
          SELECT
            COALESCE(
              NULLIF(location_type, ''),
              'Não informado'
            ) as label,
            COUNT(*) as count,
            NULL::numeric as amount
          FROM visible_features
          GROUP BY label
        `)}) as location_type_distribution,
        (${topChartJson(`
          SELECT
            COALESCE(
              NULLIF(police_circumscription, ''),
              'Não informado'
            ) as label,
            COUNT(*) as count,
            NULL::numeric as amount
          FROM visible_features
          GROUP BY label
        `)}) as police_circumscription_distribution,
        (${topChartJson(`
          SELECT
            COALESCE(NULLIF(delegacia, ''), 'Não informado') as label,
            COUNT(*) as count,
            NULL::numeric as amount
          FROM visible_features
          GROUP BY label
        `)}) as police_unit_distribution,
        (${topChartJson(`
          SELECT
            COALESCE(
              NULLIF(record.value->>'tipo_arma', ''),
              NULLIF(record.value->>'calibre', ''),
              'Não informado'
            ) as label,
            COUNT(*) as count,
            NULL::numeric as amount
          FROM visible_records record
          WHERE record.value->>'type' = 'produtividade_armas'
          GROUP BY label
        `)}) as weapon_type_distribution,
        (${topChartJson(`
          SELECT
            COALESCE(NULLIF(record.value->>'tipo_droga', ''), 'Não informado') as label,
            COUNT(*) as count,
            SUM(${DRUG_GRAMS_SQL}) as amount
          FROM visible_records record
          WHERE record.value->>'type' = 'produtividade_entorpecentes'
          GROUP BY label
        `)}) as drug_type_distribution
    `;
  }

  private buildCategoryBucketLateralSql(sourceAlias: string): string {
    return `
      CROSS JOIN LATERAL (
        SELECT DISTINCT category_name
        FROM (
          SELECT NULLIF(btrim(rubrica.value), '') AS category_name
          FROM unnest(${sourceAlias}.all_rubricas) AS rubrica(value)
          UNION ALL
          SELECT NULLIF(btrim(${sourceAlias}.category), '')
        ) category_names
        WHERE category_name IS NOT NULL
      ) AS category_bucket
    `;
  }

  private buildDateWhere(params?: {
    beforeDate?: string;
    afterDate?: string;
  }): Prisma.MapFeatureWhereInput {
    const where: Prisma.MapFeatureWhereInput = {};

    if (params?.beforeDate || params?.afterDate) {
      where.data_ocorrencia = {};

      if (params.beforeDate) {
        where.data_ocorrencia.lte = params.beforeDate;
      }

      if (params.afterDate) {
        where.data_ocorrencia.gte = params.afterDate;
      }
    }

    return where;
  }

  private appendSqlFilters(
    conditions: string[],
    queryParams: SqlParam[],
    initialParamIndex: number,
    params?: MapFeaturesFilterParams,
    options: SqlFilterOptions = {}
  ): number {
    const includeCategories = options.includeCategories ?? true;
    const includePeriods = options.includePeriods ?? true;
    const includeBounds = options.includeBounds ?? true;
    const includeHours = options.includeHours ?? true;
    let paramIndex = initialParamIndex;

    if (params?.beforeDate) {
      conditions.push(`data_ocorrencia <= $${paramIndex++}`);
      queryParams.push(params.beforeDate);
    }

    if (params?.afterDate) {
      conditions.push(`data_ocorrencia >= $${paramIndex++}`);
      queryParams.push(params.afterDate);
    }

    const categories = this.normalizeStringList(params?.categories);
    if (includeCategories && categories?.length) {
      const categoryPlaceholders = categories
        .map(() => `$${paramIndex++}`)
        .join(', ');
      conditions.push(
        `search_categories && ARRAY[${categoryPlaceholders}]::text[]`
      );
      queryParams.push(...categories);
    }

    if (includePeriods && params?.periods?.length) {
      const placeholders = params.periods
        .map(() => `$${paramIndex++}`)
        .join(', ');
      conditions.push(`${PERIOD_KEY_SQL} IN (${placeholders})`);
      queryParams.push(
        ...params.periods.map((period) => this.normalizePeriodKey(period))
      );
    }

    if (includeHours) {
      paramIndex = this.appendHourFilter(
        conditions,
        queryParams,
        paramIndex,
        params
      );
    }

    if (includeBounds && this.hasBounds(params)) {
      conditions.push(
        `geom && ST_MakeEnvelope($${paramIndex}, $${
          paramIndex + 1
        }, $${paramIndex + 2}, $${paramIndex + 3}, 4326)`
      );
      queryParams.push(
        params.minLon,
        params.minLat,
        params.maxLon,
        params.maxLat
      );
      paramIndex += 4;
    }

    return paramIndex;
  }

  private appendHourFilter(
    conditions: string[],
    queryParams: SqlParam[],
    initialParamIndex: number,
    params?: Pick<MapFeaturesFilterParams, 'startHour' | 'endHour'>
  ): number {
    let paramIndex = initialParamIndex;
    const startHour = params?.startHour;
    const endHour = params?.endHour;

    if (startHour === undefined && endHour === undefined) {
      return paramIndex;
    }

    if (startHour !== undefined && endHour !== undefined) {
      if (startHour <= endHour) {
        conditions.push(
          `${OCCURRENCE_HOUR_SQL} BETWEEN $${paramIndex} AND $${
            paramIndex + 1
          }`
        );
      } else {
        conditions.push(
          `(${OCCURRENCE_HOUR_SQL} >= $${paramIndex} OR ${OCCURRENCE_HOUR_SQL} <= $${
            paramIndex + 1
          })`
        );
      }

      queryParams.push(startHour, endHour);
      return paramIndex + 2;
    }

    if (startHour !== undefined) {
      conditions.push(`${OCCURRENCE_HOUR_SQL} >= $${paramIndex++}`);
      queryParams.push(startHour);
    }

    if (endHour !== undefined) {
      conditions.push(`${OCCURRENCE_HOUR_SQL} <= $${paramIndex++}`);
      queryParams.push(endHour);
    }

    return paramIndex;
  }

  private hasBounds(
    params?: MapFeaturesFilterParams
  ): params is MapFeaturesBoundsFilter {
    return (
      params?.minLon !== undefined &&
      params.minLat !== undefined &&
      params.maxLon !== undefined &&
      params.maxLat !== undefined
    );
  }

  private normalizePeriodKey(period: string): string {
    return period
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('pt-BR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ç/g, 'c');
  }

  private normalizeImlLookupValue(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ')
      .trim();
  }

  private buildBoWhere(
    numBo: string,
    anoBo?: number,
    delegacia?: string
  ): Prisma.MapFeatureWhereInput {
    const where: Prisma.MapFeatureWhereInput = { num_bo: numBo };

    if (anoBo !== undefined) {
      where.ano_bo = anoBo;
    }

    if (delegacia !== undefined) {
      where.delegacia = delegacia;
    }

    return where;
  }

  private async hydrateMissingSourceRecords(
    feature: MapFeature
  ): Promise<MapFeature> {
    if (!this.hydrateMissingSourceRecordsEnabled) {
      return feature;
    }

    const featureData = this.normalizeFeatureData(feature.feature_data);
    const existingSourceTables = new Set(
      featureData.records.map((record) => record.source_table)
    );
    const missingSourceTables = feature.source_tables.filter(
      (sourceTable) => !existingSourceTables.has(sourceTable)
    );

    if (missingSourceTables.length === 0) {
      return feature;
    }

    const hydratedRecords: SourceRecord[] = [];

    for (const sourceTable of missingSourceTables) {
      const records = await this.getRawSourceRecords(feature, sourceTable);
      hydratedRecords.push(...records);
    }

    if (hydratedRecords.length === 0) {
      return feature;
    }

    const records = [...featureData.records, ...hydratedRecords];

    return {
      ...feature,
      feature_data: {
        ...featureData,
        all_rubricas: this.getAllRubricas(featureData.all_rubricas, records),
        records,
        summary: this.summarizeFeatureRecords(records),
      },
    };
  }

  private normalizeFeatureData(featureData: MapFeatureData): MapFeatureData {
    const records = featureData.records ?? [];

    return {
      location: featureData.location ?? {},
      occurrence: featureData.occurrence ?? {},
      all_rubricas: featureData.all_rubricas ?? [],
      records,
      summary: featureData.summary ?? this.summarizeFeatureRecords(records),
    };
  }

  private async getRawSourceRecords(
    feature: MapFeature,
    sourceTable: string
  ): Promise<SourceRecord[]> {
    const config = getSourceTableConfig(sourceTable);

    if (!config) {
      return [];
    }

    const query = `
      SELECT *
      FROM ${qualifiedTableName(sourceTable)}
      WHERE NULLIF(btrim(${this.sourceTextColumnExpression(
        config.columnMappings.num_bo
      )}), '') = $1
        AND ${this.sourceIntegerExpression(config.columnMappings.ano_bo)} = $2
        AND ${this.sourceTextExpression(config.columnMappings.delegacia)} = $3
        AND ROUND(${this.sourceNumberExpression(
          config.columnMappings.latitude
        )}, 4) = ROUND($4::numeric, 4)
        AND ROUND(${this.sourceNumberExpression(
          config.columnMappings.longitude
        )}, 4) = ROUND($5::numeric, 4)
      ORDER BY id
    `;

    const rows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      query,
      feature.num_bo,
      feature.ano_bo,
      feature.delegacia ?? '',
      feature.latitude,
      feature.longitude
    );

    return rows.map((row) => config.extractRecord(row, sourceTable));
  }

  private getAllRubricas(
    existingRubricas: string[],
    records: SourceRecord[]
  ): string[] {
    const rubricas = new Set(existingRubricas);

    records.forEach((record) => {
      if ('rubrica' in record && record.rubrica) {
        rubricas.add(record.rubrica);
      }
    });

    return [...rubricas];
  }

  private summarizeFeatureRecords(
    records: SourceRecord[]
  ): MapFeatureData['summary'] {
    return {
      total_records: records.length,
      celulares_count: records.filter((record) => record.type === 'celular')
        .length,
      veiculos_count: records.filter((record) => record.type === 'veiculo')
        .length,
      objetos_count: records.filter((record) => record.type === 'objeto')
        .length,
      dados_criminais_count: records.filter(
        (record) => record.type === 'dados_criminais'
      ).length,
      produtividade_count: records.filter((record) =>
        [
          'produtividade_armas',
          'produtividade_entorpecentes',
          'produtividade_veiculos',
          'produtividade_pessoa',
        ].includes(record.type)
      ).length,
    };
  }

  private sourceTextExpression(column: string | undefined): string {
    if (!column) {
      return `''::text`;
    }

    return `COALESCE(NULLIF(btrim(${this.sourceTextColumnExpression(
      column
    )}), ''), '')`;
  }

  private sourceIntegerExpression(column: string): string {
    return `TRUNC(${this.sourceNumberExpression(column)})`;
  }

  private sourceNumberExpression(column: string): string {
    const normalized = this.normalizedSourceNumberTextExpression(column);

    return `CASE
            WHEN ${normalized} ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN ${normalized}::numeric
            ELSE NULL
          END`;
  }

  private normalizedSourceNumberTextExpression(column: string): string {
    const compact = `regexp_replace(btrim(${this.sourceTextColumnExpression(
      column
    )}), '\\s+', '', 'g')`;

    return `CASE
            WHEN ${compact} = '' THEN NULL
            WHEN ${compact} LIKE '%,%' AND ${compact} LIKE '%.%' AND strpos(reverse(${compact}), ',') < strpos(reverse(${compact}), '.')
              THEN replace(replace(${compact}, '.', ''), ',', '.')
            WHEN ${compact} LIKE '%,%' AND ${compact} LIKE '%.%'
              THEN replace(${compact}, ',', '')
            WHEN ${compact} LIKE '%,%'
              THEN replace(${compact}, ',', '.')
            ELSE ${compact}
          END`;
  }

  private sourceTextColumnExpression(column: string): string {
    return `${quoteIdentifier(column)}::text`;
  }

  private mapPrismaFeature(row: PrismaMapFeature): MapFeature {
    return {
      id: row.id,
      num_bo: row.num_bo,
      ano_bo: row.ano_bo,
      delegacia: row.delegacia ?? null,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      location_hash: row.location_hash,
      geom: null, // Don't return raw geometry
      category: row.category,
      rubrica_for_styling: row.rubrica_for_styling,
      data_ocorrencia: row.data_ocorrencia,
      source_tables: row.source_tables,
      feature_data: row.feature_data as unknown as MapFeatureData,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private toChartBuckets(rows: ChartBucketRow[]) {
    return rows.map((row) => ({
      label: row.label?.trim() || 'Não informado',
      count: Number(row.count),
      amount:
        row.amount === undefined || row.amount === null
          ? null
          : Number(row.amount),
    }));
  }

  private toChartBucketsFromJson(value: unknown) {
    return this.toChartBuckets(this.parseJsonArray(value) as ChartBucketRow[]);
  }

  private toCategoryStatsFromJson(
    value: unknown
  ): MapFeaturesCategoryStats[] {
    return this.parseJsonArray(value)
      .map((item) => {
        const row = item as {
          category?: unknown;
          count?: unknown;
          rubrica_for_styling?: unknown;
          is_rubrica?: unknown;
        };
        const category = String(row.category ?? '').trim();

        return {
          name: category,
          count: Number(row.count ?? 0),
          rubricaForStyling: String(row.rubrica_for_styling ?? category),
          sourceType: row.is_rubrica ? ('rubrica' as const) : ('derived' as const),
        };
      })
      .filter((category) => category.name.length > 0);
  }

  private toPeriodStatsFromJson(value: unknown): MapFeaturesPeriodStats[] {
    return this.parseJsonArray(value).map((item) => {
      const row = item as { name?: unknown; count?: unknown };
      return {
        name: String(row.name ?? ''),
        count: Number(row.count ?? 0),
      };
    });
  }

  private parseJsonArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];

    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private formatDateOnly(date: Date | null): string | null {
    return date ? date.toISOString().slice(0, 10) : null;
  }
}
