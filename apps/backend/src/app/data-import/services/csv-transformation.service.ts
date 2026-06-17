import { Injectable, Logger } from '@nestjs/common';

import { StringUtils } from '../utils/string.utils';

import { DatabaseService } from './database.service';
import { RustToolService } from './rust-tool.service';
import { getErrorMessage } from '../../shared/error.utils';
@Injectable()
export class CsvTransformationService {
  private readonly logger = new Logger(CsvTransformationService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly rustToolService: RustToolService
  ) {}
  async checkIfHeadersNeedNormalization(csvPath: string): Promise<boolean> {
    const fs = require('fs');
    const readline = require('readline');

    const fileStream = fs.createReadStream(csvPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    try {
      for await (const line of rl as AsyncIterable<string>) {
        const headers = line
          .split(';')
          .map((col) => col.trim().replace(/"/g, ''));
        rl.close();

        return headers.some(
          (header) => StringUtils.normalizeColumnName(header) !== header
        );
      }
    } catch (error) {
      rl.close();
      throw error;
    }

    return false;
  }
  async transformCsvForDatabase(
    csvPath: string,
    tableName: string,
    columnTypeOverrides: Record<string, string> = {}
  ): Promise<string> {
    const path = require('path');
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const fs = require('fs').promises;

    const execFileAsync = promisify(execFile);

    this.logger.debug(
      `Using Rust prepare command for CSV transformation: ${csvPath}`
    );

    const needsHeaderNormalization = await this.checkIfHeadersNeedNormalization(
      csvPath
    );

    if (!needsHeaderNormalization) {
      // Quick check - if headers don't need normalization, maybe we don't need transformation
      const columnInfo = await this.databaseService.getTableColumnInfo(
        tableName
      );
      const hasSpecialColumns = columnInfo.some(
        (col) => this.isSpecialColumnType(col.data_type)
      );
      const hasSpecialOverrideColumns = Object.values(columnTypeOverrides).some(
        (columnType) => this.isSpecialColumnType(columnType)
      );

      if (!hasSpecialColumns && !hasSpecialOverrideColumns) {
        this.logger.debug(
          'No transformations needed, using original CSV file'
        );
        return csvPath;
      }
    }

    try {
      const transformedCsvPath = this.createTransformedCsvPath(csvPath);

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

      const datasetHandlingPath = path.resolve(
        process.cwd(),
        'dataset-handling',
        'target',
        'release',
        'dataset-handling'
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
        `Running prepare command: ${datasetHandlingPath} ${prepareArgs.join(
          ' '
        )}`
      );
      const { stdout: prepareStdout, stderr: prepareStderr } =
        await this.rustToolService.runWithDatasetHandlingSlot<{
          stdout: string;
          stderr: string;
        }>(() =>
          execFileAsync(datasetHandlingPath, prepareArgs, {
            maxBuffer: 64 * 1024 * 1024,
          }) as Promise<{ stdout: string; stderr: string }>
        );

      if (prepareStdout) {
        this.logger.debug(`Prepare output: ${prepareStdout.trim()}`);
      }
      if (prepareStderr) {
        this.logger.warn(`Prepare warnings: ${prepareStderr.trim()}`);
      }

      try {
        await fs.access(transformedCsvPath);
        const stats = await fs.stat(transformedCsvPath);
        this.logger.debug(
          `CSV transformation completed: ${transformedCsvPath} (${stats.size} bytes)`
        );

        if (stats.size < 10) {
          throw new Error(
            `Transformed CSV file is too small (${stats.size} bytes), likely corrupted or empty`
          );
        }

        return transformedCsvPath;
      } catch {
        throw new Error(
          `Transformed CSV file was not created: ${transformedCsvPath}`
        );
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Rust CSV transformation failed: ${errorMessage}`);

      const datasetHandlingPath = path.resolve(
        process.cwd(),
        'dataset-handling',
        'target',
        'release',
        'dataset-handling'
      );
      this.logger.error(
        `Dataset handling tool path: ${datasetHandlingPath}`
      );
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
