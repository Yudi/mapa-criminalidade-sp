import { Injectable, Logger } from '@nestjs/common';

import { StringUtils } from '../utils/string.utils';

import { DatabaseService } from './database.service';
import { RustToolService } from './rust-tool.service';
import { getErrorMessage } from '../../shared/error.utils';
import { readCsvHeaderColumns } from './database/database-import-file.utils';
@Injectable()
export class CsvTransformationService {
  private readonly logger = new Logger(CsvTransformationService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly rustToolService: RustToolService
  ) {}
  async checkIfHeadersNeedNormalization(csvPath: string): Promise<boolean> {
    const headers = await readCsvHeaderColumns(csvPath);
    return headers.some(
      (header) => StringUtils.normalizeColumnName(header) !== header
    );
  }
  async transformCsvForDatabase(
    csvPath: string,
    tableName: string,
    columnTypeOverrides: Record<string, string> = {}
  ): Promise<string> {
    const fs = require('fs').promises;

    this.logger.debug(
      `Using Rust prepare command for CSV transformation: ${csvPath}`
    );

    // External CSVs are not trusted even when every database column is text.
    // Always run the row-tolerant preparation pass so malformed records are
    // rejected individually before PostgreSQL COPY sees the file.
    const transformedCsvPath = this.createTransformedCsvPath(csvPath);

    try {
      this.logger.debug(
        'Getting database column types for accurate transformation'
      );

      const columnInfo = await this.databaseService.getTableColumnInfo(
        tableName
      );
      this.logger.debug(
        `Database columns: ${JSON.stringify(
          columnInfo.map((c) => ({ name: c.column_name, type: c.data_type }))
        )}`
      );

      const columnTypes: Record<string, string> = {};
      columnInfo.forEach((col) => {
        columnTypes[col.column_name] = col.data_type;
      });
      this.applyColumnTypeOverrides(columnTypes, columnTypeOverrides);

      this.logger.debug(
        'Cleaning CSV data using Rust prepare command with intelligent type correction'
      );

      const prepareArgs = [
        'prepare',
        '--input',
        csvPath,
        '--output',
        transformedCsvPath,
        '--db-types',
        JSON.stringify(columnTypes),
      ];

      this.logger.debug(
        `Running prepare command with configured Rust binary: ${prepareArgs.join(
          ' '
        )}`
      );
      const { stdout: prepareStdout, stderr: prepareStderr } =
        await this.rustToolService.runDatasetHandlingCommand(
          prepareArgs,
          this.getPrepareTimeoutMs()
        );

      if (prepareStdout) {
        this.logger.debug(`Prepare output: ${prepareStdout.trim()}`);
      }
      if (prepareStderr) {
        this.logger.warn(`Prepare warnings: ${prepareStderr.trim()}`);
      }

      await fs.access(transformedCsvPath).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(
            `Transformed CSV file was not created: ${transformedCsvPath}`
          );
        }
        throw error;
      });
      const stats = await fs.stat(transformedCsvPath);
      this.logger.debug(
        `CSV transformation completed: ${transformedCsvPath} (${stats.size} bytes)`
      );

      const manifestPath = `${transformedCsvPath}.manifest.json`;
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
        sourceRows?: unknown;
        acceptedRows?: unknown;
        rejectedRows?: unknown;
      };
      if (
        !Number.isInteger(manifest.sourceRows) ||
        !Number.isInteger(manifest.acceptedRows) ||
        !Number.isInteger(manifest.rejectedRows) ||
        (manifest.acceptedRows as number) <= 0 ||
        (manifest.sourceRows as number) !==
          (manifest.acceptedRows as number) + (manifest.rejectedRows as number)
      ) {
        throw new Error(
          `Rust preparation manifest is invalid for ${transformedCsvPath}`
        );
      }

      return transformedCsvPath;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Rust CSV transformation failed: ${errorMessage}`);
      await Promise.allSettled([
        fs.rm(transformedCsvPath, { force: true }),
        fs.rm(`${transformedCsvPath}.manifest.json`, { force: true }),
        fs.rm(`${transformedCsvPath}.rejected.csv`, { force: true }),
      ]);

      const datasetHandlingPath = this.rustToolService.getRustBinaryPath();
      this.logger.error(`Dataset handling tool path: ${datasetHandlingPath}`);
      this.logger.error(`Input CSV path: ${csvPath}`);

      try {
        await fs.access(datasetHandlingPath);
        this.logger.debug(`Rust binary exists at: ${datasetHandlingPath}`);
      } catch {
        this.logger.error(
          `Rust binary not found at: ${datasetHandlingPath}`
        );
        throw new Error(
          `Rust dataset-handling binary not found at: ${datasetHandlingPath}. Please run 'cargo build --release' in the dataset-handling directory.`
        );
      }

      try {
        await fs.access(csvPath);
        this.logger.debug(`Input CSV exists at: ${csvPath}`);
      } catch {
        this.logger.error(`Input CSV not found at: ${csvPath}`);
        throw new Error(`Input CSV file not found: ${csvPath}`);
      }

      // Don't fall back to original file - rethrow the error so it's properly handled
      throw new Error(
        `CSV transformation failed: ${errorMessage}. This may be due to data format issues that need to be resolved.`
      );
    }
  }

  private getPrepareTimeoutMs(): number {
    const configured = Number(
      process.env.DATA_IMPORT_CSV_PREPARE_TIMEOUT_MS ?? 20 * 60 * 1000
    );
    return Number.isFinite(configured) && configured > 0
      ? Math.min(configured, 60 * 60 * 1000)
      : 20 * 60 * 1000;
  }

  private createTransformedCsvPath(csvPath: string): string {
    const path = require('path');
    const { randomUUID } = require('crypto');
    const parsedPath = path.parse(csvPath);
    const uniqueSuffix = `${process.pid}_${Date.now()}_${randomUUID().slice(
      0,
      8
    )}`;

    return path.join(
      parsedPath.dir,
      `${parsedPath.name}_${uniqueSuffix}_transformed${parsedPath.ext}`
    );
  }

  private applyColumnTypeOverrides(
    columnTypes: Record<string, string>,
    columnTypeOverrides: Record<string, string>
  ): void {
    for (const [columnName, columnType] of Object.entries(
      columnTypeOverrides
    )) {
      const normalizedColumnName = StringUtils.normalizeColumnName(columnName);
      columnTypes[normalizedColumnName] = columnType.toLowerCase();
    }
  }

  private isSpecialColumnType(columnType: string): boolean {
    const normalizedColumnType = columnType.toLowerCase();

    return (
      normalizedColumnType === 'date' ||
      normalizedColumnType.includes('time') ||
      normalizedColumnType.includes('double precision') ||
      normalizedColumnType.includes('real') ||
      normalizedColumnType.includes('float') ||
      normalizedColumnType.includes('numeric') ||
      normalizedColumnType.includes('int')
    );
  }

  /**
   * Transform data for database insertion (handle Excel serial dates, etc.)
   * @deprecated Use transformCsvForDatabase for COPY operations
   */
  async transformDataForDatabase(
    tableName: string,
    results: Record<string, string>[]
  ): Promise<Record<string, string>[]> {
    if (results.length === 0) return results;

    const columnInfo = await this.databaseService.getTableColumnInfo(tableName);
    const dateColumns = columnInfo
      .filter((col) => col.data_type === 'date')
      .map((col) => col.column_name);

    if (dateColumns.length === 0) {
      return results; // No date columns, no transformation needed
    }

    this.logger.debug(
      `Transforming data for ${
        dateColumns.length
      } date columns: ${dateColumns.join(', ')}`
    );

    return results.map((record) => {
      const transformedRecord = { ...record };

      dateColumns.forEach((dateColumn) => {
        const value = transformedRecord[dateColumn];
        if (value && value.trim()) {
          const transformedValue = this.convertExcelSerialDateIfNeeded(
            value.trim()
          );
          if (transformedValue !== value) {
            this.logger.verbose(
              `Converted Excel serial date: ${value} → ${transformedValue}`
            );
            transformedRecord[dateColumn] = transformedValue;
          }
        }
      });

      return transformedRecord;
    });
  }
  convertExcelSerialDateIfNeeded(value: string): string {
    // If it's already a proper date format, return as-is
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(value) ||
      /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value) ||
      /^\d{1,2}-\d{1,2}-\d{4}$/.test(value)
    ) {
      return value;
    }

    const serial = parseInt(value, 10);
    if (isNaN(serial) || serial < 30000 || serial > 73050) {
      return value; // Not a valid Excel serial date
    }

    try {
      // Excel serial date conversion
      // Excel epoch: January 1, 1900 (but Excel incorrectly treats 1900 as leap year)
      // So we use January 1, 1900 as day 1, but account for the leap year bug
      const excelEpoch = new Date('1899-12-30'); // Adjusted for Excel's leap year bug
      const date = new Date(
        excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000
      );

      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');

      return `${year}-${month}-${day}`;
    } catch {
      this.logger.warn(`Failed to convert Excel serial date: ${value}`);
      return value; // Return original value if conversion fails
    }
  }
}
