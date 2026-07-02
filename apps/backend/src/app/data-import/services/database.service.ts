import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  qualifiedTableName,
  quoteIdentifier,
  quoteLiteral,
  RAW_SCHEMA,
} from '../../prisma/sql.utils';
import { TableColumnInfo } from '../types/data-import.types';
import { StringUtils } from '../utils/string.utils';
import { RustToolService } from './rust-tool.service';
import {
  getErrorMessage,
  getErrorStringProperty,
} from '../../shared/error.utils';
import {
  applyColumnTypeOverrides,
  buildRawSourceColumns,
  createTextTypeMap,
  isRawSystemColumn,
  matchCsvColumnsToTableColumns,
  normalizeColumnTypeOverrides,
  RAW_SOURCE_COLUMN_TYPE,
} from './database/database-import-column.utils';
import {
  convertToPostgresSharedPath,
  POSTGRES_SHARED_IMPORT_PATH,
  readCsvHeaderColumns,
} from './database/database-import-file.utils';
import {
  buildCopyCsvSql,
  buildCreateRawTableSql,
} from './database/database-import-sql.utils';

type DatabaseExecutor = PrismaService | Prisma.TransactionClient;

@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);
  private headerMapping: Map<string, string> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly rustToolService: RustToolService
  ) {}
  private convertToPostgresPath(localPath: string): string {
    this.logger.debug(
      `Path conversion setup: postgresSharedPath=${POSTGRES_SHARED_IMPORT_PATH}`
    );

    const postgresPath = convertToPostgresSharedPath(localPath);

    if (postgresPath !== localPath) {
      this.logger.log(
        `Docker path conversion: ${localPath} → ${postgresPath}`
      );
      return postgresPath;
    }

    this.logger.debug(`Path unchanged (not in temp): ${localPath}`);
    return localPath;
  }
  async checkTableExists(tableName: string): Promise<boolean> {
    const result = await this.prisma.$queryRaw<{ exists: boolean }[]>(
      Prisma.sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = ${RAW_SCHEMA}
        AND table_name = ${tableName}
      ) AS "exists";
    `
    );

    return result[0]?.exists ?? false;
  }
  async getTableRecordCount(
    tableName: string,
    db: DatabaseExecutor = this.prisma
  ): Promise<number> {
    const result = await db.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`SELECT COUNT(*)::bigint as count FROM ${Prisma.raw(
        this.rawTable(tableName)
      )}`
    );
    return Number(result[0]?.count ?? 0);
  }
  async hasTableRows(
    tableName: string,
    db: DatabaseExecutor = this.prisma
  ): Promise<boolean> {
    const [result] = await db.$queryRaw<{ has_rows: boolean }[]>(
      Prisma.sql`
        SELECT EXISTS (
          SELECT 1
          FROM ${Prisma.raw(this.rawTable(tableName))}
          LIMIT 1
        ) AS has_rows
      `
    );

    return result?.has_rows ?? false;
  }
  async markTableForMapFeaturesEtl(
    tableName: string,
    db: DatabaseExecutor = this.prisma
  ): Promise<void> {
    await db.dynamicTableMetadata.updateMany({
      where: { table_name: tableName },
      data: { needs_geom_update: true },
    });
  }
  async markTableAsNonGeographic(tableName: string): Promise<void> {
    await this.prisma.dynamicTableMetadata.updateMany({
      where: { table_name: tableName },
      data: { needs_geom_update: false },
    });
  }
  async ensureImlLookupIndex(tableName: string): Promise<void> {
    this.validateImlTableName(tableName);

    const indexName = `idx_${tableName}_bo_lookup`;
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS ${quoteIdentifier(indexName)}
      ON ${this.rawTable(tableName)} (
        ${quoteIdentifier('NUM_BO_NORMALIZED')},
        ${quoteIdentifier('ANO_BO')},
        ${quoteIdentifier('DELEGACIA_REGISTRO_NORMALIZED')}
      )
      WHERE ${quoteIdentifier('NUM_BO_NORMALIZED')} <> ''
        AND ${quoteIdentifier('ANO_BO')} <> ''
        AND ${quoteIdentifier('DELEGACIA_REGISTRO_NORMALIZED')} <> ''
    `);
  }
  async getImlImportedMonths(tableName: string): Promise<Set<number>> {
    this.validateImlTableName(tableName);
    const columns = await this.getTableColumns(tableName);
    if (
      !columns.includes('ANO_REFERENCIA') ||
      !columns.includes('MES_REFERENCIA')
    ) {
      return new Set();
    }
    const referenceYear = tableName.slice(-4);

    const result = await this.prisma.$queryRawUnsafe<
      Array<{ month: string | null }>
    >(`
      SELECT DISTINCT ${quoteIdentifier('MES_REFERENCIA')} AS month
      FROM ${this.rawTable(tableName)}
      WHERE ${quoteIdentifier('MES_REFERENCIA')} ~ '^(?:[1-9]|1[0-2])$'
        AND ${quoteIdentifier('ANO_REFERENCIA')} = ${quoteLiteral(referenceYear)}
    `);

    return new Set(result.map((row) => Number(row.month)));
  }
  async deleteImlMonthRows(
    tableName: string,
    year: number,
    month: number,
    db: DatabaseExecutor = this.prisma
  ): Promise<void> {
    this.validateImlTableName(tableName);
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12
    ) {
      throw new Error(`Invalid IML reference month: ${year}-${month}`);
    }

    await db.$executeRawUnsafe(`
      DELETE FROM ${this.rawTable(tableName)}
      WHERE ${quoteIdentifier('ANO_REFERENCIA')} = ${quoteLiteral(String(year))}
        AND ${quoteIdentifier('MES_REFERENCIA')} = ${quoteLiteral(String(month))}
    `);
  }
  async getTableColumns(
    tableName: string,
    db: DatabaseExecutor = this.prisma
  ): Promise<string[]> {
    const result = await db.$queryRaw<{ column_name: string }[]>(
      Prisma.sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = ${tableName} AND table_schema = ${RAW_SCHEMA}
      ORDER BY ordinal_position
    `
    );

    return result.map((row) => row.column_name);
  }
  async getTableColumnInfo(
    tableName: string,
    db: DatabaseExecutor = this.prisma
  ): Promise<TableColumnInfo[]> {
    const result = await db.$queryRaw<TableColumnInfo[]>(
      Prisma.sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = ${tableName} AND table_schema = ${RAW_SCHEMA}
      ORDER BY ordinal_position
    `
    );

    return result;
  }
  async analyzeCSVStructureWithRust(
    csvPath: string
  ): Promise<{ columns: string[]; types: Record<string, string> }> {
    return this.analyzeDataFileStructureWithRust(csvPath);
  }

  async analyzeDataFileStructureWithRust(
    dataPath: string
  ): Promise<{ columns: string[]; types: Record<string, string> }> {
    this.logger.debug(`Analyzing tabular file with Rust tool: ${dataPath}`);

    try {
      // Ensure Rust tool is available before analysis
      const isAvailable = await this.rustToolService.isRustToolAvailable();
      if (!isAvailable) {
        throw new Error(
          'Rust tool binary is not available. Cannot process large datasets without Rust analyzer.'
        );
      }

      // Run Rust analyzer - no fallback, Rust is required for large datasets
      const result = await this.rustToolService.runRustAnalyzer(dataPath);

      const columns = result.columns.map((col) => col.normalized_name);
      const types: Record<string, string> = {};

      result.columns.forEach((col) => {
        types[col.normalized_name] = col.recommended_type;
        this.logger.verbose(
          `Column "${col.normalized_name}": ${
            col.recommended_type
          } (samples: ${col.sample_values.slice(0, 3).join(', ')})`
        );

        // Additional validation: info about mixed date format detection
        if (
          col.recommended_type === 'DATE' &&
          col.sample_values.some((v) => /^\d{4,5}$/.test(v))
        ) {
          this.logger.debug(
            `Column "${
              col.normalized_name
            }" contains mixed date formats (regular dates + Excel serial dates): ${col.sample_values
              .slice(0, 3)
              .join(', ')}`
          );
        }
      });

      this.logger.debug(`Rust analysis complete: ${columns.length} columns`);
      this.logger.verbose(`Columns: ${columns.join(', ')}`);

      return { columns, types };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Rust analyzer failed: ${errorMessage}`);
      throw new Error(
        `Tabular file analysis failed: ${errorMessage}. Rust tool is required for processing large datasets.`
      );
    }
  }
  async shouldNormalizeExistingTable(tableName: string): Promise<boolean> {
    try {
      // Check if table has the exact columns from static migrations
      const columns = await this.getTableColumns(tableName);

      // If table has mixed case columns, it was likely created by static migrations
      const hasMixedCase = columns.some(
        (col) => col !== col.toUpperCase() && col !== col.toLowerCase()
      );

      // If table has only basic columns (id, data, created_at), it might be broken
      const hasOnlyBasicColumns =
        columns.length <= 3 &&
        columns.includes('id') &&
        columns.includes('created_at');

      return hasMixedCase || hasOnlyBasicColumns;
    } catch (error) {
      this.logger.debug(
        `Could not analyze table ${tableName} for normalization: ${getErrorMessage(error)}`
      );
      return false;
    }
  }
  async ensureTableMatchesCSV(
    tableName: string,
    csvPath: string,
    columnTypeOverrides: Record<string, string> = {}
  ): Promise<void> {
    return this.ensureTableMatchesDataFile(
      tableName,
      csvPath,
      columnTypeOverrides
    );
  }

  async ensureTableMatchesDataFile(
    tableName: string,
    dataPath: string,
    columnTypeOverrides: Record<string, string> = {}
  ): Promise<void> {
    this.logger.log(`Verifying table ${tableName} matches source structure`);
    const existingColumns = await this.getTableColumns(tableName);
    const { columns: sourceColumns, types: inferredTypes } =
      await this.analyzeDataFileStructureWithRust(dataPath);
    const logicalTypes = applyColumnTypeOverrides(
      inferredTypes,
      columnTypeOverrides
    );
    this.logger.debug(
      `Source columns (${sourceColumns.length}): ${sourceColumns.join(', ')}`
    );
    this.logger.debug(
      `Existing DB columns (${
        existingColumns.length
      }): ${existingColumns.join(', ')}`
    );

    const missingColumns = sourceColumns.filter(
      (normalizedSourceCol) =>
        !existingColumns.some(
          (dbCol) =>
            // Primary strategy: normalized comparison
            StringUtils.normalizeColumnName(dbCol) === normalizedSourceCol ||
            // Fallback: direct match (for already normalized columns)
            dbCol === normalizedSourceCol ||
            // Legacy: case-insensitive match
            dbCol.toLowerCase() === normalizedSourceCol.toLowerCase()
        )
    );

    this.logger.debug(
      `Missing columns (${missingColumns.length}): ${missingColumns.join(
        ', '
      )}`
    );

    if (missingColumns.length > 0) {
      this.logger.log(
        `Adding ${
          missingColumns.length
        } missing columns to table ${tableName}: ${missingColumns.join(', ')}`
      );
      for (const column of missingColumns) {
        const columnType = RAW_SOURCE_COLUMN_TYPE;
        const alterSQL = `ALTER TABLE ${this.rawTable(
          tableName
        )} ADD COLUMN ${quoteIdentifier(column)} ${columnType}`;

        await this.prisma.$executeRawUnsafe(alterSQL);
        this.logger.verbose(`Added raw text column: ${column}`);
      }

      // Update metadata (optional - only if metadata table exists)
      try {
        const existingSourceColumns = existingColumns.filter(
          (column) => !isRawSystemColumn(column)
        );
        const allColumns = [...existingSourceColumns, ...missingColumns];
        const storageTypes = createTextTypeMap(allColumns);
        const updatedLogicalTypes = { ...logicalTypes };
        existingSourceColumns.forEach((column) => {
          if (!updatedLogicalTypes[column]) {
            updatedLogicalTypes[column] = RAW_SOURCE_COLUMN_TYPE;
          }
        });

        const columnsJson = {
          columns: allColumns,
          types: storageTypes,
          logicalTypes: updatedLogicalTypes,
          originalColumns: sourceColumns,
          schemaName: RAW_SCHEMA,
          sourcePath: dataPath,
          csvPath: dataPath,
        };

        // Set needs_geom_update = TRUE so DynamicTablesService will process geography
        await this.upsertDynamicTableMetadata(tableName, columnsJson);
      } catch (metadataError) {
        this.logger.warn(
          `Could not update table metadata (table may not exist): ${getErrorMessage(metadataError)}`
        );
      }

      this.logger.log(
        `Table ${tableName} updated with ${missingColumns.length} new columns`
      );
    } else {
      this.logger.log(`Table ${tableName} structure matches source file`);
    }
  }
  async createTableFromCSV(tableName: string, csvPath: string): Promise<void> {
    return this.createTableFromCSVWithTypes(tableName, csvPath);
  }

  async createTableFromCSVWithTypes(
    tableName: string,
    csvPath: string,
    columnTypeOverrides: Record<string, string> = {}
  ): Promise<void> {
    return this.createTableFromDataFileWithTypes(
      tableName,
      csvPath,
      columnTypeOverrides
    );
  }

  async createTableFromDataFileWithTypes(
    tableName: string,
    dataPath: string,
    columnTypeOverrides: Record<string, string> = {}
  ): Promise<void> {
    this.logger.log(`Creating table ${tableName} based on source structure`);
    await this.ensureRawSchema();
    const { columns: rawColumns, types: inferredRawTypes } =
      await this.analyzeDataFileStructureWithRust(dataPath);
    const logicalRawTypes = applyColumnTypeOverrides(
      inferredRawTypes,
      columnTypeOverrides
    );

    if (rawColumns.length === 0) {
      throw new Error(`No columns found in source file: ${dataPath}`);
    }

    const { columns, types, logicalTypes } = buildRawSourceColumns(
      rawColumns,
      logicalRawTypes,
      this.logger
    );

    if (columns.length === 0) {
      throw new Error(
        `No valid columns found in source file after filtering: ${dataPath}`
      );
    }
    const createTableSQL = buildCreateRawTableSql(
      this.rawTable(tableName),
      columns,
      types
    );

    this.logger.debug(
      `Creating table with ${columns.length} processed columns`
    );
    this.logger.verbose(
      `Raw column definitions: ${columns
        .map((col) => `${col}:${types[col]}`)
        .join(', ')}`
    );
    this.logger.verbose(
      `Logical source types: ${columns
        .map((col) => `${col}:${logicalTypes[col]}`)
        .join(', ')}`
    );
    await this.prisma.$executeRawUnsafe(createTableSQL);

    // Track the table in dynamic_table_metadata (optional - only if metadata table exists)
    try {
      const columnsJson = {
        columns,
        types,
        logicalTypes,
        originalColumns: rawColumns, // Keep track of raw column names from the source file
        processedColumns: columns, // Track the processed column names used in DB
        schemaName: RAW_SCHEMA,
        sourcePath: dataPath, // Track which source file this came from
        csvPath: dataPath, // Backward-compatible metadata key for existing readers
      };

      // Set needs_geom_update = TRUE so DynamicTablesService will process geography
      await this.upsertDynamicTableMetadata(tableName, columnsJson);
    } catch (metadataError) {
      this.logger.warn(
        `Could not track table metadata (table may not exist): ${getErrorMessage(metadataError)}`
      );
    }

    this.logger.log(
      `Table ${tableName} created with ${
        columns.length
      } columns: ${columns.join(', ')}`
    );
  }
  async importCsvWithCopy(
    tableName: string,
    csvFilePath: string,
    db: DatabaseExecutor = this.prisma
  ): Promise<number> {
    this.logger.log(
      `Using PostgreSQL COPY for fast bulk import: ${csvFilePath}`
    );
    const postgresFilePath = this.convertToPostgresPath(csvFilePath);

    const countBefore = await this.getTableRecordCount(tableName, db);
    const actualColumns = await this.getTableColumns(tableName, db);
    const csvColumns = await readCsvHeaderColumns(csvFilePath);

    this.logger.debug(
      `Column matching: CSV(${csvColumns.length}) vs DB(${actualColumns.length})`
    );
    this.logger.verbose(`CSV columns: ${csvColumns.join(', ')}`);
    this.logger.verbose(`DB columns: ${actualColumns.join(', ')}`);

    const { columnMapping, mappedColumns, unmatchedColumns } =
      matchCsvColumnsToTableColumns(csvColumns, actualColumns, this.logger);

    this.logger.debug(
      `Column mapping: ${mappedColumns.length} mapped, ${unmatchedColumns.length} unmatched`
    );

    if (unmatchedColumns.length > 0) {
      this.logger.warn(
        `Table ${tableName}: Unmatched CSV columns (${
          unmatchedColumns.length
        }): ${unmatchedColumns.join(', ')}`
      );
    }

    if (columnMapping.size === 0) {
      throw new Error(
        `No matching columns found between CSV and table ${tableName}. ` +
          `CSV columns: ${csvColumns.join(', ')}. ` +
          `DB columns: ${actualColumns.join(', ')}`
      );
    }
    const dbColumnsToUse = Array.from(columnMapping.values());

    const copyQuery = buildCopyCsvSql(
      this.rawTable(tableName),
      dbColumnsToUse,
      postgresFilePath
    );

    this.logger.debug(`Executing COPY command for ${tableName}`);
    this.logger.verbose(`COPY columns: ${dbColumnsToUse.join(', ')}`);

    const startTime = Date.now();

    try {
      await db.$executeRawUnsafe(copyQuery);
      const countAfter = await this.getTableRecordCount(tableName, db);
      const recordCount = countAfter - countBefore;
      const importTime = Date.now() - startTime;

      this.logger.log(
        `COPY import completed: ${recordCount} records in ${(
          importTime / 1000
        ).toFixed(1)}s ` +
          `(${Math.round(recordCount / (importTime / 1000))} records/sec)`
      );

      return recordCount;
    } catch (error) {
      const importTime = Date.now() - startTime;
      this.logger.error(
        `COPY import failed after ${(importTime / 1000).toFixed(1)}s`
      );
      this.logger.error(`File path: ${postgresFilePath}`);
      this.logger.error(
        `Expected columns (${dbColumnsToUse.length}): ${dbColumnsToUse.join(
          ', '
        )}`
      );
      this.logger.error(
        `CSV columns (${csvColumns.length}): ${csvColumns.join(', ')}`
      );
      const errorCode = getErrorStringProperty(error, 'code');
      const errorWhere = getErrorStringProperty(error, 'where');

      if (errorCode === '22P04') {
        this.logger.error(
          `This is a PostgreSQL data format error - likely column count mismatch or malformed CSV data`
        );
        if (csvColumns.length !== dbColumnsToUse.length) {
          this.logger.error(
            `Column count mismatch: CSV has ${csvColumns.length} columns, DB expects ${dbColumnsToUse.length}`
          );
        }
        if (errorWhere) {
          this.logger.error(`Problematic data: ${errorWhere}`);
        }
      }

      this.logger.error(`Original error: ${getErrorMessage(error)}`);
      throw error;
    }
  }
  async importParquetFilesWithRust(
    tableName: string,
    parquetPaths: string[],
    columnTypeOverrides: Record<string, string>
  ): Promise<number> {
    return await this.rustToolService.importParquetFilesToPostgres(
      parquetPaths,
      RAW_SCHEMA,
      tableName,
      columnTypeOverrides
    );
  }
  async truncateTable(
    tableName: string,
    db: DatabaseExecutor = this.prisma
  ): Promise<void> {
    this.logger.debug(`Truncating table ${tableName}`);
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${this.rawTable(tableName)}`);
  }

  async applyColumnTypeOverridesToEmptyTable(
    tableName: string,
    columnTypeOverrides: Record<string, string>,
    db: DatabaseExecutor = this.prisma
  ): Promise<void> {
    const overrides = normalizeColumnTypeOverrides(columnTypeOverrides);
    if (overrides.size === 0) {
      return;
    }

    await this.getTableRecordCount(tableName, db);
    this.logger.debug(
      `Keeping raw table ${tableName} as TEXT; ${overrides.size} logical type hints remain import-time cleanup hints`
    );
  }

  async runImportTransaction<T>(
    operation: (db: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    return await this.prisma.$transaction(operation, {
      maxWait: 30_000,
      timeout: 3_900_000,
    });
  }

  private rawTable(tableName: string): string {
    return qualifiedTableName(tableName);
  }

  private validateImlTableName(tableName: string): void {
    if (!/^registro_obitos_iml_\d{4}$/.test(tableName)) {
      throw new Error(`Invalid IML table name: ${tableName}`);
    }
  }

  private async ensureRawSchema(): Promise<void> {
    await this.prisma.$executeRaw(
      Prisma.sql`CREATE SCHEMA IF NOT EXISTS ${Prisma.raw(
        quoteIdentifier(RAW_SCHEMA)
      )}`
    );
  }

  private async upsertDynamicTableMetadata(
    tableName: string,
    columnsJson: Prisma.InputJsonValue
  ): Promise<void> {
    await this.prisma.dynamicTableMetadata.upsert({
      where: { table_name: tableName },
      update: {
        schema_name: RAW_SCHEMA,
        columns_json: columnsJson,
        needs_geom_update: true,
      },
      create: {
        table_name: tableName,
        schema_name: RAW_SCHEMA,
        columns_json: columnsJson,
        needs_geom_update: true,
      },
    });
  }

}
