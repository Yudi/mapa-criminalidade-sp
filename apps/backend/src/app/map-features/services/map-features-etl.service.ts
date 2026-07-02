import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { dynamicTableColumnsJsonSchema } from '../../data-import/schemas/dynamic-table-metadata.schema';
import { PrismaService } from '../../prisma/prisma.service';
import { qualifiedTableName } from '../../prisma/sql.utils';
import { MapFeaturesEtlStatus } from '../types/map-features.types';
import {
  getSourceTableConfig,
  isMapFeaturesSourceTable,
} from '../config/source-tables.config';
import { MapFeaturesQueryService } from './map-features-query.service';
import {
  DatabaseExecutor,
  ETL_STAGING_SORT_COLUMNS,
  ETL_STAGING_TABLE,
  getMapFeaturesEtlBatchSize,
  MAP_FEATURES_ETL_TRANSACTION_CONFIG,
} from './etl/map-features-etl-config';
import {
  buildProcessableRowsWhere,
  buildRemoveSourceTableFeaturesSql,
  buildSelectColumns,
  buildSourceSortSelectColumns,
} from './etl/map-features-etl-sql';
import { getErrorMessage } from '../../shared/error.utils';
import {
  AggregatedFeature,
  MapFeaturesEtlAggregator,
  SourceTableCursor,
} from './etl/map-features-etl-aggregator';

@Injectable()
export class MapFeaturesEtlService {
  private readonly logger = new Logger(MapFeaturesEtlService.name);
  private readonly BATCH_SIZE = getMapFeaturesEtlBatchSize();
  private readonly aggregator = new MapFeaturesEtlAggregator(this.logger);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queryService: MapFeaturesQueryService
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
        maxWait: MAP_FEATURES_ETL_TRANSACTION_CONFIG.MAX_WAIT_MS,
        timeout: MAP_FEATURES_ETL_TRANSACTION_CONFIG.TIMEOUT_MS,
      }
    );
  }

  private async configureEtlTransaction(
    tx: Prisma.TransactionClient
  ): Promise<void> {
    await tx.$executeRawUnsafe(
      `SET LOCAL lock_timeout = '${MAP_FEATURES_ETL_TRANSACTION_CONFIG.LOCK_TIMEOUT_MS}ms'`
    );
    await tx.$executeRawUnsafe(
      `SET LOCAL statement_timeout = '${MAP_FEATURES_ETL_TRANSACTION_CONFIG.STATEMENT_TIMEOUT_MS}ms'`
    );
    await tx.$executeRawUnsafe(
      `SET LOCAL idle_in_transaction_session_timeout = '${MAP_FEATURES_ETL_TRANSACTION_CONFIG.IDLE_TIMEOUT_MS}ms'`
    );
  }

  private async invalidateReadCacheIfNeeded(
    refreshedTables: number
  ): Promise<void> {
    if (refreshedTables === 0) {
      return;
    }

    const deleted = await this.queryService.invalidateReadCache();
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
      buildRemoveSourceTableFeaturesSql(),
      tableName
    );
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
    const selectColumns = buildSelectColumns(config, columnSet);
    const sortSelectColumns = buildSourceSortSelectColumns(config);
    await this.createStagingTable(
      tableName,
      selectColumns,
      sortSelectColumns,
      buildProcessableRowsWhere(config),
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

      cursor = this.aggregator.getSourceTableCursor(rows[rows.length - 1]);

      // Aggregate ordered rows by (NUM_BO, ANO_BO, delegacia, location).
      // The last group may continue in the next batch, so keep it open.
      const aggregated = this.aggregator.aggregateRows(
        rows,
        tableName,
        config,
        columnSet,
        carryover
      );
      const { completed, nextCarryover } =
        this.aggregator.splitFinalAggregatedFeature(aggregated);

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
