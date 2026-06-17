import { Injectable, Logger, Optional } from '@nestjs/common';
import * as crypto from 'crypto';
import { Prisma } from '../../../generated/prisma/client';
import { dynamicTableColumnsJsonSchema } from '../../data-import/schemas/dynamic-table-metadata.schema';
import { PrismaService } from '../../prisma/prisma.service';
import { qualifiedTableName, quoteIdentifier } from '../../prisma/sql.utils';
import { RedisCacheService } from '../../shared/cache/redis-cache.service';
import {
  MapFeatureData,
  LocationData,
  OccurrenceMetadata,
  MapFeaturesEtlStatus,
} from '../types/map-features.types';
import {
  getSourceTableConfig,
  isMapFeaturesSourceTable,
  LOCATION_COLUMN_MAPPINGS,
  OCCURRENCE_COLUMN_MAPPINGS,
} from '../config/source-tables.config';
import {
  MIN_OCCURRENCE_DATE,
  MIN_OCCURRENCE_DATE_ISO,
} from '../config/date-range.config';
import { MAP_FEATURES_CACHE_KEY_PREFIX } from './map-features-query.service';
import {
  formatSourceDateOnly,
  parseSourceBooleanFlag,
  parseSourceDate,
  parseSourceInteger,
  parseSourceNumber,
} from '../utils/source-value.utils';
import { getErrorMessage } from '../../shared/error.utils';

type DatabaseExecutor = PrismaService | Prisma.TransactionClient;
const ETL_STAGING_TABLE = '"map_features_etl_stage"';
const ETL_STAGING_SORT_COLUMNS = [
  '"__etl_sort_num_bo"',
  '"__etl_sort_ano_bo"',
  '"__etl_sort_delegacia"',
  '"__etl_sort_latitude_bucket"',
  '"__etl_sort_longitude_bucket"',
  'id',
] as const;
const ETL_TRANSACTION_CONFIG = {
  MAX_WAIT_MS: getPositiveIntegerEnv(
    'MAP_FEATURES_ETL_TRANSACTION_MAX_WAIT_MS',
    30_000,
    1_000,
    120_000
  ),
  TIMEOUT_MS: getPositiveIntegerEnv(
    'MAP_FEATURES_ETL_TRANSACTION_TIMEOUT_MS',
    3_900_000,
    300_000,
    7_200_000
  ),
  LOCK_TIMEOUT_MS: getPositiveIntegerEnv(
    'MAP_FEATURES_ETL_LOCK_TIMEOUT_MS',
    15_000,
    1_000,
    120_000
  ),
  STATEMENT_TIMEOUT_MS: getPositiveIntegerEnv(
    'MAP_FEATURES_ETL_STATEMENT_TIMEOUT_MS',
    600_000,
    60_000,
    3_900_000
  ),
  IDLE_TIMEOUT_MS: getPositiveIntegerEnv(
    'MAP_FEATURES_ETL_IDLE_TRANSACTION_TIMEOUT_MS',
    120_000,
    30_000,
    600_000
  ),
} as const;

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

@Injectable()
export class MapFeaturesEtlService {
  private readonly logger = new Logger(MapFeaturesEtlService.name);
  private readonly BATCH_SIZE = this.getBatchSize();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly cache?: RedisCacheService
  ) {}
  async runFullEtl(): Promise<{ processed: number; errors: string[] }> {
    this.logger.log('Starting full ETL for map_features...');
    const startTime = Date.now();

    const sourceTables = await this.getSourceTables();
    this.logger.log(`Found ${sourceTables.length} source tables to process`);

    let totalProcessed = 0;
    let refreshedTables = 0;
    const errors: string[] = [];

    for (const tableName of sourceTables) {
      try {
        const count = await this.refreshSourceTable(tableName);
        totalProcessed += count;
        refreshedTables++;
        this.logger.log(`Processed ${tableName}: ${count} features`);
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        const msg = `Failed to process ${tableName}: ${errorMessage}`;
        this.logger.error(msg);
        errors.push(msg);
        await this.updateEtlStatus(tableName, 'error', 0, errorMessage);
      }
    }

    const duration = (Date.now() - startTime) / 1000;
    this.logger.log(
      `ETL completed: ${totalProcessed} features in ${duration.toFixed(1)}s`
    );

    await this.invalidateReadCacheIfNeeded(refreshedTables);
    return { processed: totalProcessed, errors };
  }
  async runIncrementalEtl(): Promise<{ processed: number; errors: string[] }> {
    this.logger.log('Starting incremental ETL for map_features...');

    const result = await this.prisma.dynamicTableMetadata.findMany({
      where: { needs_geom_update: true },
      select: { table_name: true },
    });

    const tablesToProcess = result
      .map((r: { table_name: string }) => r.table_name)
      .filter(isMapFeaturesSourceTable);

    if (tablesToProcess.length === 0) {
      this.logger.log('No tables need ETL processing');
      return { processed: 0, errors: [] };
    }

    this.logger.log(`${tablesToProcess.length} tables need ETL processing`);

    let totalProcessed = 0;
    let refreshedTables = 0;
    const errors: string[] = [];

    for (const tableName of tablesToProcess) {
      try {
        const count = await this.refreshSourceTable(tableName);
        totalProcessed += count;
        refreshedTables++;

        await this.prisma.dynamicTableMetadata.update({
          where: { table_name: tableName },
          data: { needs_geom_update: false },
        });

        this.logger.log(`Processed ${tableName}: ${count} features`);
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        const msg = `Failed to process ${tableName}: ${errorMessage}`;
        this.logger.error(msg);
        errors.push(msg);
        await this.updateEtlStatus(tableName, 'error', 0, errorMessage);
      }
    }

    await this.invalidateReadCacheIfNeeded(refreshedTables);
    return { processed: totalProcessed, errors };
  }
  private async refreshSourceTable(tableName: string): Promise<number> {
    await this.updateEtlStatus(tableName, 'processing', 0, null);

    const processedCount = await this.runEtlTransaction(async (tx) => {
      await this.removeSourceTableFeatures(tableName, tx);
      return await this.processSourceTable(tableName, tx, false);
    });

    await this.updateEtlStatus(tableName, 'completed', processedCount, null);
    return processedCount;
  }

  private async runEtlTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    return await this.prisma.$transaction(
      async (tx) => {
        await this.configureEtlTransaction(tx);
        return await operation(tx);
      },
      {
        maxWait: ETL_TRANSACTION_CONFIG.MAX_WAIT_MS,
        timeout: ETL_TRANSACTION_CONFIG.TIMEOUT_MS,
      }
    );
  }

  private async configureEtlTransaction(
    tx: Prisma.TransactionClient
  ): Promise<void> {
    await tx.$executeRawUnsafe(
      `SET LOCAL lock_timeout = '${ETL_TRANSACTION_CONFIG.LOCK_TIMEOUT_MS}ms'`
    );
    await tx.$executeRawUnsafe(
      `SET LOCAL statement_timeout = '${ETL_TRANSACTION_CONFIG.STATEMENT_TIMEOUT_MS}ms'`
    );
    await tx.$executeRawUnsafe(
      `SET LOCAL idle_in_transaction_session_timeout = '${ETL_TRANSACTION_CONFIG.IDLE_TIMEOUT_MS}ms'`
    );
  }

  private async invalidateReadCacheIfNeeded(
    refreshedTables: number
  ): Promise<void> {
    if (refreshedTables === 0 || !this.cache) {
      return;
    }

    const deleted = await this.cache.deleteByPrefix(
      `${MAP_FEATURES_CACHE_KEY_PREFIX}:`
    );
    this.logger.log(
      `Invalidated ${deleted} map feature cache entr${
        deleted === 1 ? 'y' : 'ies'
      } after refreshing ${refreshedTables} source table(s)`
    );
  }

  private async removeSourceTableFeatures(
    tableName: string,
    db: DatabaseExecutor = this.prisma
  ): Promise<void> {
    await db.$executeRawUnsafe(
      `
        DELETE FROM map_features
        WHERE source_tables @> ARRAY[$1]::text[]
          AND cardinality(source_tables) = 1
      `,
      tableName
    );

    await db.$executeRawUnsafe(
      this.buildRemoveSourceTableFeaturesSql(),
      tableName
    );
  }

  private buildRemoveSourceTableFeaturesSql(): string {
    return `
      UPDATE map_features
      SET
        source_tables = array_remove(source_tables, $1),
        feature_data = (
          WITH remaining_records AS (
            SELECT COALESCE(jsonb_agg(record.value), '[]'::jsonb) AS records
            FROM jsonb_array_elements(
              COALESCE(feature_data->'records', '[]'::jsonb)
            ) AS record(value)
            WHERE record.value->>'source_table' <> $1
          ),
          remaining_rubricas AS (
            SELECT COALESCE(jsonb_agg(DISTINCT rubrica), '[]'::jsonb) AS all_rubricas
            FROM (
              SELECT to_jsonb(record.value->>'rubrica') AS rubrica
              FROM jsonb_array_elements(
                (SELECT records FROM remaining_records)
              ) AS record(value)
              WHERE NULLIF(record.value->>'rubrica', '') IS NOT NULL
            ) AS rubrica_rows
          )
          SELECT jsonb_build_object(
            'location',
            COALESCE(feature_data->'location', '{}'::jsonb),
            'occurrence',
            COALESCE(feature_data->'occurrence', '{}'::jsonb),
            'all_rubricas',
            remaining_rubricas.all_rubricas,
            'records',
            remaining_records.records,
            'summary',
            jsonb_build_object(
              'total_records',
              jsonb_array_length(remaining_records.records),
              'celulares_count',
              (
                SELECT COUNT(*)
                FROM jsonb_array_elements(remaining_records.records) AS record(value)
                WHERE record.value->>'type' = 'celular'
              ),
              'veiculos_count',
              (
                SELECT COUNT(*)
                FROM jsonb_array_elements(remaining_records.records) AS record(value)
                WHERE record.value->>'type' = 'veiculo'
              ),
              'objetos_count',
              (
                SELECT COUNT(*)
                FROM jsonb_array_elements(remaining_records.records) AS record(value)
                WHERE record.value->>'type' = 'objeto'
              ),
              'dados_criminais_count',
              (
                SELECT COUNT(*)
                FROM jsonb_array_elements(remaining_records.records) AS record(value)
                WHERE record.value->>'type' = 'dados_criminais'
              ),
              'produtividade_count',
              (
                SELECT COUNT(*)
                FROM jsonb_array_elements(remaining_records.records) AS record(value)
                WHERE record.value->>'type' IN (
                  'produtividade_armas',
                  'produtividade_entorpecentes',
                  'produtividade_veiculos',
                  'produtividade_pessoa'
                )
              )
            )
          )
          FROM remaining_records, remaining_rubricas
        ),
        updated_at = NOW()
      WHERE source_tables @> ARRAY[$1]::text[]
        AND cardinality(source_tables) > 1
    `;
  }
  private async processSourceTable(
    tableName: string,
    db: DatabaseExecutor = this.prisma,
    updateStatus = true
  ): Promise<number> {
    const config = getSourceTableConfig(tableName);
    if (!config) {
      throw new Error(`No configuration found for table: ${tableName}`);
    }

    if (updateStatus) {
      await this.updateEtlStatus(tableName, 'processing', 0, null, db);
    }

    const columns = await this.getTableColumns(tableName, db);
    const columnSet = new Set(columns.map((c) => c.toUpperCase()));

    const requiredCols = [
      config.columnMappings.num_bo,
      config.columnMappings.ano_bo,
      config.columnMappings.latitude,
      config.columnMappings.longitude,
    ];

    for (const col of requiredCols) {
      if (!columnSet.has(col.toUpperCase())) {
        throw new Error(
          `Required column ${col} not found in table ${tableName}`
        );
      }
    }

    // Build SELECT query with all needed columns
    const selectColumns = this.buildSelectColumns(config, columnSet);
    const sortSelectColumns = this.buildSourceSortSelectColumns(config);
    await this.createStagingTable(
      tableName,
      selectColumns,
      sortSelectColumns,
      this.buildProcessableRowsWhere(config),
      db
    );

    let processedCount = 0;
    let processedRows = 0;
    let cursor: SourceTableCursor | null = null;
    let carryover = new Map<string, AggregatedFeature>();

    while (true) {
      const cursorWhere = cursor
        ? `WHERE (${ETL_STAGING_SORT_COLUMNS.join(', ')}) > (
          $1::text,
          $2::numeric,
          $3::text,
          $4::numeric,
          $5::numeric,
          $6::integer
        )`
        : '';
      const cursorValues = cursor
        ? [
            cursor.numBo,
            cursor.anoBo,
            cursor.delegacia,
            cursor.latitudeBucket,
            cursor.longitudeBucket,
            cursor.id,
          ]
        : [];
      const query = `
        SELECT *
        FROM ${ETL_STAGING_TABLE}
        ${cursorWhere}
        ORDER BY ${ETL_STAGING_SORT_COLUMNS.join(', ')}
        LIMIT ${this.BATCH_SIZE}
      `;

      const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(
        query,
        ...cursorValues
      );

      if (rows.length === 0) {
        break;
      }

      cursor = this.getSourceTableCursor(rows[rows.length - 1]);

      // Aggregate ordered rows by (NUM_BO, ANO_BO, delegacia, location).
      // The last group may continue in the next batch, so keep it open.
      const aggregated = this.aggregateRows(
        rows,
        tableName,
        config,
        columnSet,
        carryover
      );
      const { completed, nextCarryover } =
        this.splitFinalAggregatedFeature(aggregated);

      const inserted = await this.upsertFeatures(completed, db);
      processedCount += inserted;
      carryover = nextCarryover;
      processedRows += rows.length;

      this.logger.debug(
        `${tableName}: processed ${processedRows} staged source rows`
      );
    }

    const inserted = await this.upsertFeatures(carryover, db);
    processedCount += inserted;

    if (updateStatus) {
      await this.updateEtlStatus(
        tableName,
        'completed',
        processedCount,
        null,
        db
      );
    }
    return processedCount;
  }

  private async createStagingTable(
    tableName: string,
    selectColumns: string,
    sortSelectColumns: string,
    processableRowsWhere: string,
    db: DatabaseExecutor
  ): Promise<void> {
    await db.$executeRawUnsafe(
      `DROP TABLE IF EXISTS pg_temp.${ETL_STAGING_TABLE}`
    );
    await db.$executeRawUnsafe(`
      CREATE TEMP TABLE ${ETL_STAGING_TABLE} ON COMMIT DROP AS
      SELECT ${selectColumns}, ${sortSelectColumns}
      FROM ${this.rawTable(tableName)}
      WHERE ${processableRowsWhere}
    `);
    await db.$executeRawUnsafe(`
      CREATE INDEX "idx_map_features_etl_stage_sort"
      ON ${ETL_STAGING_TABLE} (${ETL_STAGING_SORT_COLUMNS.join(', ')})
    `);
    await db.$executeRawUnsafe(`ANALYZE ${ETL_STAGING_TABLE}`);
  }
  private aggregateRows(
    rows: Record<string, unknown>[],
    tableName: string,
    config: NonNullable<ReturnType<typeof getSourceTableConfig>>,
    columnSet: Set<string>,
    features = new Map<string, AggregatedFeature>()
  ): Map<string, AggregatedFeature> {
    // Debug: Log first row to check column names
    if (rows.length > 0 && config.columnMappings.delegacia) {
      const firstRow = rows[0];
      const delegaciaCol = config.columnMappings.delegacia;
      this.logger.debug(
        `[DEBUG] Table: ${tableName}, Delegacia column: ${delegaciaCol}, Value: ${
          firstRow[delegaciaCol]
        }, Keys: ${Object.keys(firstRow)
          .filter((k) => k.toLowerCase().includes('deleg'))
          .join(', ')}`
      );
    }

    for (const row of rows) {
      // Parse coordinates
      const lat = this.parseCoordinate(row[config.columnMappings.latitude]);
      const lon = this.parseCoordinate(row[config.columnMappings.longitude]);

      if (lat === null || lon === null) continue;

      // Validate coordinates are in São Paulo state range
      if (lat < -25 || lat > -19 || lon < -54 || lon > -44) continue;

      const numBo = String(row[config.columnMappings.num_bo]);
      const anoBo = parseSourceInteger(row[config.columnMappings.ano_bo]);
      const delegacia = row[config.columnMappings.delegacia]
        ? String(row[config.columnMappings.delegacia])
        : null;

      if (!numBo || anoBo === null) continue;

      // But store the exact coordinates of the first point found
      const locationHash = this.createLocationHash(lat, lon);

      // Before 2022, NUM_BO is not unique across delegacias
      const delegaciaKey = delegacia || '';
      const key = `${numBo}|${anoBo}|${delegaciaKey}|${locationHash}`;

      let feature = features.get(key);
      if (!feature) {
        feature = this.createBaseFeature(
          numBo,
          anoBo,
          delegacia,
          lat, // Store exact latitude
          lon, // Store exact longitude
          locationHash,
          row,
          config,
          columnSet
        );
        features.set(key, feature);
      }

      this.addRecordToFeature(feature, row, tableName, config);
    }

    return features;
  }
  private createBaseFeature(
    numBo: string,
    anoBo: number,
    delegacia: string | null,
    lat: number,
    lon: number,
    locationHash: string,
    row: Record<string, unknown>,
    config: NonNullable<ReturnType<typeof getSourceTableConfig>>,
    columnSet: Set<string>
  ): AggregatedFeature {
    // Parse date
    let dataOcorrencia: Date | null = null;
    if (config.columnMappings.data_ocorrencia) {
      const dateVal = row[config.columnMappings.data_ocorrencia];
      if (dateVal) {
        dataOcorrencia = this.parseOccurrenceDate(dateVal);
      }
    }

    // Determine category
    let category: string;
    let rubricaForStyling: string;

    if (config.columnMappings.rubrica && row[config.columnMappings.rubrica]) {
      category = String(row[config.columnMappings.rubrica]);
      rubricaForStyling = category;
    } else if (config.derivedCategory) {
      category = config.derivedCategory;
      rubricaForStyling = config.stylingRubrica || category;
    } else {
      category = 'Outros';
      rubricaForStyling = 'default';
    }

    // Extract location data
    const location = this.extractLocationData(row, columnSet);

    // Extract occurrence metadata
    const occurrence = this.extractOccurrenceMetadata(row, columnSet);

    return {
      num_bo: numBo,
      ano_bo: anoBo,
      delegacia,
      latitude: lat,
      longitude: lon,
      location_hash: locationHash,
      category,
      rubrica_for_styling: rubricaForStyling,
      data_ocorrencia: dataOcorrencia,
      source_tables: [],
      feature_data: {
        location,
        occurrence,
        all_rubricas: [],
        records: [],
        summary: {
          total_records: 0,
          celulares_count: 0,
          veiculos_count: 0,
          objetos_count: 0,
          dados_criminais_count: 0,
          produtividade_count: 0,
        },
      },
    };
  }

  private parseOccurrenceDate(value: unknown): Date | null {
    const date = parseSourceDate(value);
    const text = String(value).trim();

    if (!date || date < MIN_OCCURRENCE_DATE) {
      this.logger.warn(
        `Ignoring occurrence date before ${MIN_OCCURRENCE_DATE_ISO}: "${text}"`
      );
      return null;
    }

    return date;
  }
  private addRecordToFeature(
    feature: AggregatedFeature,
    row: Record<string, unknown>,
    tableName: string,
    config: NonNullable<ReturnType<typeof getSourceTableConfig>>
  ): void {
    if (!feature.source_tables.includes(tableName)) {
      feature.source_tables.push(tableName);
    }

    // Extract record using config's extractor
    const record = config.extractRecord(row, tableName);
    feature.feature_data.records.push(record);

    if (config.columnMappings.rubrica && row[config.columnMappings.rubrica]) {
      const rubrica = String(row[config.columnMappings.rubrica]);
      if (!feature.feature_data.all_rubricas.includes(rubrica)) {
        feature.feature_data.all_rubricas.push(rubrica);
      }
    }

    feature.feature_data.summary.total_records++;
    switch (record.type) {
      case 'celular':
        feature.feature_data.summary.celulares_count++;
        break;
      case 'veiculo':
        feature.feature_data.summary.veiculos_count++;
        break;
      case 'objeto':
        feature.feature_data.summary.objetos_count++;
        break;
      case 'dados_criminais':
        feature.feature_data.summary.dados_criminais_count++;
        break;
      default:
        feature.feature_data.summary.produtividade_count++;
    }
  }
  private async upsertFeatures(
    features: Map<string, AggregatedFeature>,
    db: DatabaseExecutor = this.prisma
  ): Promise<number> {
    if (features.size === 0) return 0;

    const values: unknown[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    for (const feature of features.values()) {
      const geomWkt = `POINT(${feature.longitude} ${feature.latitude})`;

      placeholders.push(`(
        $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++},
        $${paramIndex++}, ST_SetSRID(ST_GeomFromText($${paramIndex++}), 4326),
        $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}
      )`);

      values.push(
        feature.num_bo,
        feature.ano_bo,
        feature.delegacia,
        feature.latitude,
        feature.longitude,
        feature.location_hash,
        geomWkt,
        feature.category,
        feature.rubrica_for_styling,
        feature.data_ocorrencia,
        feature.source_tables,
        JSON.stringify(feature.feature_data)
      );
    }

    // Note: The unique index uses COALESCE(delegacia, '') for null handling
    const query = `
      INSERT INTO map_features (
        num_bo, ano_bo, delegacia, latitude, longitude, location_hash, geom,
        category, rubrica_for_styling, data_ocorrencia, source_tables, feature_data
      )
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (num_bo, ano_bo, COALESCE(delegacia, ''), location_hash) DO UPDATE SET
        category = EXCLUDED.category,
        rubrica_for_styling = EXCLUDED.rubrica_for_styling,
        data_ocorrencia = COALESCE(EXCLUDED.data_ocorrencia, map_features.data_ocorrencia),
        source_tables = (
          SELECT ARRAY(SELECT DISTINCT UNNEST(map_features.source_tables || EXCLUDED.source_tables))
        ),
        feature_data = (
          WITH merged_records AS (
            SELECT COALESCE(jsonb_agg(record), '[]'::jsonb) AS records
            FROM (
              SELECT existing_record.value AS record
              FROM jsonb_array_elements(
                COALESCE(map_features.feature_data->'records', '[]'::jsonb)
              ) AS existing_record(value)
              WHERE NOT (existing_record.value->>'source_table' = ANY(EXCLUDED.source_tables))
              UNION ALL
              SELECT incoming_record.value AS record
              FROM jsonb_array_elements(
                COALESCE(EXCLUDED.feature_data->'records', '[]'::jsonb)
              ) AS incoming_record(value)
            ) AS record_rows
          ),
          merged_rubricas AS (
            SELECT COALESCE(jsonb_agg(DISTINCT rubrica), '[]'::jsonb) AS all_rubricas
            FROM (
              SELECT existing_rubrica.value AS rubrica
              FROM jsonb_array_elements(
                COALESCE(map_features.feature_data->'all_rubricas', '[]'::jsonb)
              ) AS existing_rubrica(value)
              UNION
              SELECT incoming_rubrica.value AS rubrica
              FROM jsonb_array_elements(
                COALESCE(EXCLUDED.feature_data->'all_rubricas', '[]'::jsonb)
              ) AS incoming_rubrica(value)
            ) AS rubrica_rows
          )
          SELECT jsonb_build_object(
            'location',
            COALESCE(map_features.feature_data->'location', '{}'::jsonb) ||
              COALESCE(EXCLUDED.feature_data->'location', '{}'::jsonb),
            'occurrence',
            COALESCE(map_features.feature_data->'occurrence', '{}'::jsonb) ||
              COALESCE(EXCLUDED.feature_data->'occurrence', '{}'::jsonb),
            'all_rubricas',
            merged_rubricas.all_rubricas,
            'records',
            merged_records.records,
            'summary',
            jsonb_build_object(
              'total_records',
              jsonb_array_length(merged_records.records),
              'celulares_count',
              (
                SELECT COUNT(*)
                FROM jsonb_array_elements(merged_records.records) AS record(value)
                WHERE record.value->>'type' = 'celular'
              ),
              'veiculos_count',
              (
                SELECT COUNT(*)
                FROM jsonb_array_elements(merged_records.records) AS record(value)
                WHERE record.value->>'type' = 'veiculo'
              ),
              'objetos_count',
              (
                SELECT COUNT(*)
                FROM jsonb_array_elements(merged_records.records) AS record(value)
                WHERE record.value->>'type' = 'objeto'
              ),
              'dados_criminais_count',
              (
                SELECT COUNT(*)
                FROM jsonb_array_elements(merged_records.records) AS record(value)
                WHERE record.value->>'type' = 'dados_criminais'
              ),
              'produtividade_count',
              (
                SELECT COUNT(*)
                FROM jsonb_array_elements(merged_records.records) AS record(value)
                WHERE record.value->>'type' IN (
                  'produtividade_armas',
                  'produtividade_entorpecentes',
                  'produtividade_veiculos',
                  'produtividade_pessoa'
                )
              )
            )
          )
          FROM merged_records, merged_rubricas
        ),
        updated_at = NOW()
    `;

    await db.$executeRawUnsafe(query, ...values);
    return features.size;
  }
  private async getSourceTables(): Promise<string[]> {
    const result = await this.prisma.dynamicTableMetadata.findMany({
      select: { table_name: true, columns_json: true },
      orderBy: { table_name: 'asc' },
    });

    return result
      .filter((row) => this.hasValidSourceMetadata(row))
      .map((r) => r.table_name)
      .filter(isMapFeaturesSourceTable);
  }

  private hasValidSourceMetadata(row: {
    table_name: string;
    columns_json: unknown;
  }): boolean {
    if (row.columns_json === null) {
      return false;
    }

    const result = dynamicTableColumnsJsonSchema.safeParse(row.columns_json);
    if (!result.success) {
      this.logger.warn(
        `Ignoring source table ${row.table_name} because columns_json is invalid: ${result.error.issues
          .map((issue) => issue.message)
          .join('; ')}`
      );
      return false;
    }

    return true;
  }

  private async getTableColumns(
    tableName: string,
    db: DatabaseExecutor = this.prisma
  ): Promise<string[]> {
    const result = await db.$queryRaw<
      { column_name: string }[]
    >(Prisma.sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'raw'
        AND table_name = ${tableName}
      ORDER BY ordinal_position
    `);
    return result.map((r: { column_name: string }) => r.column_name);
  }

  private buildSelectColumns(
    config: NonNullable<ReturnType<typeof getSourceTableConfig>>,
    columnSet: Set<string>
  ): string {
    const columns = new Set<string>();

    // Always include id
    columns.add('id');

    Object.values(config.columnMappings).forEach((col) => {
      if (col && columnSet.has(col.toUpperCase())) {
        columns.add(quoteIdentifier(col));
      }
    });

    for (const alts of Object.values(LOCATION_COLUMN_MAPPINGS)) {
      for (const col of alts) {
        if (columnSet.has(col.toUpperCase())) {
          columns.add(quoteIdentifier(col));
        }
      }
    }

    for (const alts of Object.values(OCCURRENCE_COLUMN_MAPPINGS)) {
      for (const col of alts) {
        if (columnSet.has(col.toUpperCase())) {
          columns.add(quoteIdentifier(col));
        }
      }
    }

    const typeSpecificCols = this.getTypeSpecificColumns(config.recordType);
    for (const col of typeSpecificCols) {
      if (columnSet.has(col.toUpperCase())) {
        columns.add(quoteIdentifier(col));
      }
    }

    return Array.from(columns).join(', ');
  }

  private buildProcessableRowsWhere(
    config: NonNullable<ReturnType<typeof getSourceTableConfig>>
  ): string {
    return [
      `NULLIF(btrim(${this.sourceTextColumnExpression(
        config.columnMappings.num_bo
      )}), '') IS NOT NULL`,
      `${this.sourceIntegerExpression(config.columnMappings.ano_bo)} IS NOT NULL`,
      `${this.sourceNumberExpression(config.columnMappings.latitude)} IS NOT NULL`,
      `${this.sourceNumberExpression(config.columnMappings.longitude)} IS NOT NULL`,
    ].join('\n          AND ');
  }

  private buildSourceSortSelectColumns(
    config: NonNullable<ReturnType<typeof getSourceTableConfig>>
  ): string {
    return [
      `${this.sourceTextExpression(
        config.columnMappings.num_bo
      )} AS "__etl_sort_num_bo"`,
      `${this.sourceIntegerExpression(
        config.columnMappings.ano_bo
      )} AS "__etl_sort_ano_bo"`,
      `${this.sourceTextExpression(
        config.columnMappings.delegacia
      )} AS "__etl_sort_delegacia"`,
      `ROUND(${this.sourceNumberExpression(
        config.columnMappings.latitude
      )}, 4) AS "__etl_sort_latitude_bucket"`,
      `ROUND(${this.sourceNumberExpression(
        config.columnMappings.longitude
      )}, 4) AS "__etl_sort_longitude_bucket"`,
    ].join(', ');
  }

  private getBatchSize(): number {
    const configured = Number(process.env.MAP_FEATURES_ETL_BATCH_SIZE ?? 2000);
    return Number.isInteger(configured) && configured >= 100 && configured <= 5000
      ? configured
      : 2000;
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

  private getSourceTableCursor(row: Record<string, unknown>): SourceTableCursor {
    return {
      numBo: String(row.__etl_sort_num_bo),
      anoBo: String(row.__etl_sort_ano_bo),
      delegacia: String(row.__etl_sort_delegacia),
      latitudeBucket: String(row.__etl_sort_latitude_bucket),
      longitudeBucket: String(row.__etl_sort_longitude_bucket),
      id: parseSourceInteger(row.id) ?? 0,
    };
  }

  private splitFinalAggregatedFeature(
    features: Map<string, AggregatedFeature>
  ): {
    completed: Map<string, AggregatedFeature>;
    nextCarryover: Map<string, AggregatedFeature>;
  } {
    if (features.size === 0) {
      return {
        completed: features,
        nextCarryover: new Map<string, AggregatedFeature>(),
      };
    }

    const entries = Array.from(features.entries());
    const [lastKey, lastFeature] = entries[entries.length - 1];
    const nextCarryover = new Map<string, AggregatedFeature>([
      [lastKey, lastFeature],
    ]);

    features.delete(lastKey);

    return {
      completed: features,
      nextCarryover,
    };
  }

  private getTypeSpecificColumns(recordType: string): string[] {
    switch (recordType) {
      case 'celular':
        return [
          'DESCR_MODO_OBJETO',
          'DESCR_TIPO_OBJETO',
          'DESCR_SUBTIPO_OBJETO',
          'MARCA_OBJETO',
          'QUANTIDADE_OBJETO',
          'FLAG_BLOQUEIO',
          'FLAG_DESBLOQUEIO',
        ];
      case 'veiculo':
        return [
          'DESCR_OCORRENCIA_VEICULO',
          'DESCR_TIPO_VEICULO',
          'DESCR_MARCA_VEICULO',
          'DESC_COR_VEICULO',
          'PLACA_VEICULO',
          'ANO_FABRICACAO',
          'ANO_MODELO',
        ];
      case 'objeto':
        return [
          'DESCR_MODO_OBJETO',
          'DESCR_TIPO_OBJETO',
          'DESCR_SUBTIPO_OBJETO',
          'MARCA_OBJETO',
          'QUANTIDADE_OBJETO',
        ];
      case 'dados_criminais':
        return ['NATUREZA_APURADA', 'DESCR_CONDUTA'];
      case 'produtividade_armas':
        return [
          'DESCRICAO_APRESENTACAO',
          'DESC_OBJETO_MODO',
          'DESC_ARMA_FOGO',
          'ARMA_NOME_MARCA',
          'CALIBRE',
        ];
      case 'produtividade_entorpecentes':
        return [
          'DESCRICAO_APRESENTACAO',
          'DESCR_TOXICO',
          'QTDE_GRAMAS_ARRED',
        ];
      case 'produtividade_veiculos':
        return [
          'DESCRICAO_APRESENTACAO',
          'DESCR_OCORRENCIA_VEICULO',
          'DESCR_TIPO_VEICULO',
          'DESCR_MARCA_VEICULO',
          'DESC_COR_VEICULO',
          'PLACA_VEICULO',
          'ANO_FABRICACAO',
          'ANO_MODELO',
        ];
      case 'produtividade_pessoa':
        return [
          'DESCRICAO_APRESENTACAO',
          'DESCR_TIPO_PESSOA',
          'SEXO_PESSOA',
          'IDADE_PESSOA',
          'COR_CUTIS',
          'COR_CURTIS',
          'DESCR_PROFISSAO',
          'DESCR_GRAU_INSTRUCAO',
          'NACIONALIDADE_PESSOA',
        ];
      default:
        return [];
    }
  }

  private parseCoordinate(value: unknown): number | null {
    return parseSourceNumber(value);
  }
  private createLocationHash(lat: number, lon: number): string {
    // Round to 4 decimal places for ~10m grid grouping
    const roundedLat = Math.round(lat * 10000) / 10000;
    const roundedLon = Math.round(lon * 10000) / 10000;
    const input = `${roundedLat.toFixed(4)}|${roundedLon.toFixed(4)}`;
    return crypto
      .createHash('md5')
      .update(input)
      .digest('hex')
      .substring(0, 16);
  }

  private extractLocationData(
    row: Record<string, unknown>,
    columnSet: Set<string>
  ): LocationData {
    const location: LocationData = {};

    for (const [key, alts] of Object.entries(LOCATION_COLUMN_MAPPINGS)) {
      for (const col of alts) {
        if (columnSet.has(col.toUpperCase()) && row[col]) {
          location[key as keyof LocationData] = String(row[col]);
          break;
        }
      }
    }

    return location;
  }

  private extractOccurrenceMetadata(
    row: Record<string, unknown>,
    columnSet: Set<string>
  ): OccurrenceMetadata {
    const metadata: OccurrenceMetadata = {};

    for (const [key, alts] of Object.entries(OCCURRENCE_COLUMN_MAPPINGS)) {
      for (const col of alts) {
        if (columnSet.has(col.toUpperCase()) && row[col]) {
          if (key === 'flagrante') {
            metadata.flagrante = parseSourceBooleanFlag(row[col]);
          } else if (key.startsWith('data_')) {
            const date = formatSourceDateOnly(row[col]);
            if (date) {
              (metadata as Record<string, unknown>)[key] = date;
            }
          } else {
            (metadata as Record<string, unknown>)[key] = String(row[col]);
          }
          break;
        }
      }
    }

    return metadata;
  }

  private async updateEtlStatus(
    tableName: string,
    status: MapFeaturesEtlStatus['status'],
    rowsProcessed: number,
    errorMessage: string | null,
    db: DatabaseExecutor = this.prisma
  ): Promise<void> {
    await db.mapFeaturesEtlStatus.upsert({
      where: { source_table: tableName },
      update: {
        status,
        rows_processed: rowsProcessed,
        error_message: errorMessage,
        last_etl_at: new Date(),
      },
      create: {
        source_table: tableName,
        status,
        rows_processed: rowsProcessed,
        error_message: errorMessage,
        last_etl_at: new Date(),
      },
    });
  }

  private rawTable(tableName: string): string {
    return qualifiedTableName(tableName);
  }
}
interface AggregatedFeature {
  num_bo: string;
  ano_bo: number;
  delegacia: string | null;
  latitude: number;
  longitude: number;
  location_hash: string;
  category: string;
  rubrica_for_styling: string;
  data_ocorrencia: Date | null;
  source_tables: string[];
  feature_data: MapFeatureData;
}

interface SourceTableCursor {
  numBo: string;
  anoBo: string;
  delegacia: string;
  latitudeBucket: string;
  longitudeBucket: string;
  id: number;
}
