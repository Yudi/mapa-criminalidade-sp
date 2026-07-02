import { PrismaService } from '../../../prisma/prisma.service';
import {
  MapFeatureCharts,
  MapFeaturesCategoryPeriodStats,
  MapFeaturesCategoryStats,
  MapFeaturesFilterParams,
  MapFeaturesPeriodStats,
} from '../../types/map-features.types';
import {
  MAP_FEATURES_CACHE_TTL_SECONDS,
  getMapFeaturesStatsCacheTtl,
  normalizeMapFeaturesFilterParams,
  normalizeStringList,
} from './map-features-query-cache';
import {
  appendSqlFilters,
  buildCategoryBucketLateralSql,
  buildChartsQuery,
  buildDateWhere,
  normalizePeriodKey,
  PERIOD_KEY_SQL,
  PERIOD_LABEL_SQL,
  PERIOD_SORT_SQL,
  PERIOD_SQL,
} from './map-features-query-sql';
import {
  formatDateOnly,
  toCategoryStatsFromJson,
  toChartBucketsFromJson,
  toPeriodStatsFromJson,
} from './map-features-result-mappers';
import { SqlParam } from './map-features-tile-query';

type CacheLoader = <T>(
  scope: string,
  payload: unknown,
  ttlSeconds: number,
  load: () => Promise<T>
) => Promise<T>;

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

type CategoryPeriodStatsQueryRow = {
  categories: unknown;
  periods: unknown;
};

type CategoryStatsRow = {
  category: string;
  count: bigint | string;
  rubrica_for_styling: string | null;
  is_rubrica: boolean | null;
};

export class MapFeaturesStatsQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly getCachedJson: CacheLoader
  ) {}

  async getCategories(
    params?: MapFeaturesFilterParams
  ): Promise<MapFeaturesCategoryStats[]> {
    return await this.getCachedJson(
      'categories',
      normalizeMapFeaturesFilterParams(params),
      getMapFeaturesStatsCacheTtl(params),
      async () => {
        const conditions: string[] = ['geom IS NOT NULL'];
        const queryParams: SqlParam[] = [];
        appendSqlFilters(conditions, queryParams, 1, params);
        const results = await this.prisma.$queryRawUnsafe<CategoryStatsRow[]>(
          buildCategoryStatsQuery(conditions.join(' AND ')),
          ...queryParams
        );

        return mapCategoryStatsRows(results);
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
        ...normalizeMapFeaturesFilterParams({
          beforeDate,
          afterDate,
          periods,
          startHour,
          endHour,
        }),
      },
      MAP_FEATURES_CACHE_TTL_SECONDS.FILTERED_STATS,
      async () => {
        const conditions: string[] = ['geom IS NOT NULL'];
        const queryParams: SqlParam[] = [longitude, latitude, radius];

        conditions.push(
          `geom && ST_Expand(ST_SetSRID(ST_MakePoint($1, $2), 4326), $3 / 111320.0)`
        );
        conditions.push(
          `ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`
        );

        appendSqlFilters(conditions, queryParams, 4, {
          beforeDate,
          afterDate,
          periods,
          startHour,
          endHour,
        });

        const results = await this.prisma.$queryRawUnsafe<CategoryStatsRow[]>(
          buildCategoryStatsQuery(conditions.join(' AND ')),
          ...queryParams
        );

        return mapCategoryStatsRows(results);
      }
    );
  }

  async getPeriods(
    params?: MapFeaturesFilterParams
  ): Promise<MapFeaturesPeriodStats[]> {
    return await this.getCachedJson(
      'periods',
      normalizeMapFeaturesFilterParams(params),
      getMapFeaturesStatsCacheTtl(params),
      async () => {
        const conditions: string[] = [
          'geom IS NOT NULL',
          `${PERIOD_SQL} IS NOT NULL`,
        ];
        const queryParams: SqlParam[] = [];
        appendSqlFilters(conditions, queryParams, 1, params, {
          includePeriods: false,
        });

        const results = await this.prisma.$queryRawUnsafe<
          { name: string; count: bigint | string }[]
        >(
          `
            SELECT
              ${PERIOD_LABEL_SQL} as name,
              COUNT(*) as count,
              ${PERIOD_SORT_SQL} as sort_order
            FROM map_features
            WHERE ${conditions.join(' AND ')}
            GROUP BY ${PERIOD_KEY_SQL}, ${PERIOD_LABEL_SQL}, ${PERIOD_SORT_SQL}
            ORDER BY sort_order ASC, name ASC
          `,
          ...queryParams
        );

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
      normalizeMapFeaturesFilterParams(params),
      getMapFeaturesStatsCacheTtl(params),
      async () => {
        const baseConditions: string[] = ['geom IS NOT NULL'];
        const queryParams: SqlParam[] = [];
        let paramIndex = appendSqlFilters(
          baseConditions,
          queryParams,
          1,
          params,
          { includePeriods: false }
        );
        const categoryConditions: string[] = [];
        const periods = normalizeStringList(params?.periods);

        if (periods?.length) {
          const placeholders = periods
            .map(() => `$${paramIndex++}`)
            .join(', ');
          categoryConditions.push(`${PERIOD_KEY_SQL} IN (${placeholders})`);
          queryParams.push(
            ...periods.map((period) => normalizePeriodKey(period))
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
                  ${buildCategoryBucketLateralSql('visible_features')}
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
          categories: toCategoryStatsFromJson(row?.categories),
          periods: toPeriodStatsFromJson(row?.periods),
        };
      }
    );
  }

  async getCharts(params?: MapFeaturesFilterParams): Promise<MapFeatureCharts> {
    return await this.getCachedJson(
      'charts',
      normalizeMapFeaturesFilterParams(params),
      MAP_FEATURES_CACHE_TTL_SECONDS.CHARTS,
      async () => {
        const conditions: string[] = ['geom IS NOT NULL'];
        const queryParams: SqlParam[] = [];
        appendSqlFilters(conditions, queryParams, 1, params);
        const whereClause = conditions.join(' AND ');

        const [charts] = await this.prisma.$queryRawUnsafe<ChartsQueryRow[]>(
          buildChartsQuery(whereClause),
          ...queryParams
        );

        return {
          totalFeatures: Number(charts?.total_features ?? 0),
          totalRecords: Number(charts?.total_records ?? 0),
          categoryDistribution: toChartBucketsFromJson(
            charts?.category_distribution
          ),
          periodDistribution: toChartBucketsFromJson(
            charts?.period_distribution
          ),
          weekdayDistribution: toChartBucketsFromJson(
            charts?.weekday_distribution
          ),
          recordTypeDistribution: toChartBucketsFromJson(
            charts?.record_type_distribution
          ),
          objectTypeDistribution: toChartBucketsFromJson(
            charts?.object_type_distribution
          ),
          vehicleBrandDistribution: toChartBucketsFromJson(
            charts?.vehicle_brand_distribution
          ),
          phoneBrandDistribution: toChartBucketsFromJson(
            charts?.phone_brand_distribution
          ),
          locationTypeDistribution: toChartBucketsFromJson(
            charts?.location_type_distribution
          ),
          policeCircumscriptionDistribution: toChartBucketsFromJson(
            charts?.police_circumscription_distribution
          ),
          policeUnitDistribution: toChartBucketsFromJson(
            charts?.police_unit_distribution
          ),
          weaponTypeDistribution: toChartBucketsFromJson(
            charts?.weapon_type_distribution
          ),
          drugTypeDistribution: toChartBucketsFromJson(
            charts?.drug_type_distribution
          ),
        };
      }
    );
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
      earliest: formatDateOnly(result?.earliest_date ?? null),
      latest: formatDateOnly(result?.latest_date ?? null),
      defaultAfter: formatDateOnly(result?.default_after_date ?? null),
    };
  }

  async getCount(params?: MapFeaturesFilterParams): Promise<number> {
    return await this.getCachedJson(
      'count',
      normalizeMapFeaturesFilterParams(params),
      getMapFeaturesStatsCacheTtl(params),
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
          appendSqlFilters(conditions, queryParams, 1, params);

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

        const where = buildDateWhere(params);

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
}

function buildCategoryStatsQuery(whereClause: string): string {
  return `
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
    ${buildCategoryBucketLateralSql('map_features')}
    WHERE ${whereClause}
    GROUP BY category_bucket.category_name
    ORDER BY count DESC
  `;
}

function mapCategoryStatsRows(
  rows: CategoryStatsRow[]
): MapFeaturesCategoryStats[] {
  return rows.map((row) => ({
    name: row.category,
    count: Number(row.count),
    rubricaForStyling: row.rubrica_for_styling ?? row.category,
    sourceType: row.is_rubrica ? ('rubrica' as const) : ('derived' as const),
  }));
}
