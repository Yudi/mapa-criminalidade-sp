import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';

import { DataCategory } from '../types/data-import.types';
import { DataCategoryConfig } from '../config/data-category.config';

import { FileOperationsService } from './file-operations.service';
import { DatabaseService } from './database.service';

@Injectable()
export class ParquetProcessingService {
  private readonly logger = new Logger(ParquetProcessingService.name);

  constructor(
    private readonly fileOperationsService: FileOperationsService,
    private readonly databaseService: DatabaseService
  ) {}

  async importParquetToDatabase(
    parquetDir: string,
    category: DataCategory,
    year: number
  ): Promise<number> {
    try {
      const files = await fs.readdir(parquetDir);
      const parquetFiles = DataCategoryConfig.filterParquetFilesForCategory(
        files.filter((file) => file.endsWith('.parquet')).sort(),
        category
      );

      if (parquetFiles.length === 0) {
        throw new Error(
          `No Parquet files matched category ${category.name} in ${parquetDir}`
        );
      }

      const tableName = DataCategoryConfig.getTableName(category, year);
      const parquetPaths = parquetFiles.map((parquetFile) =>
        path.join(parquetDir, parquetFile)
      );
      const columnTypeOverrides =
        DataCategoryConfig.getColumnTypeOverrides(category);

      await this.prepareTableForParquetFiles(
        tableName,
        parquetPaths,
        columnTypeOverrides
      );

      return await this.replaceTableWithParquetFiles(
        tableName,
        parquetPaths,
        columnTypeOverrides
      );
    } catch (error) {
      this.logger.error(
        `Failed to import Parquet files for ${category.name} ${year}:`,
        error
      );
      throw error;
    }
  }

  async importSingleParquetFile(
    parquetPath: string,
    category: DataCategory,
    year: number
  ): Promise<number> {
    const tableName = DataCategoryConfig.getTableName(category, year);
    const columnTypeOverrides =
      DataCategoryConfig.getColumnTypeOverrides(category);

    this.logger.log(`Importing ${parquetPath} to table ${tableName}`);

    try {
      await this.prepareTableForParquetFiles(
        tableName,
        [parquetPath],
        columnTypeOverrides
      );

      return await this.replaceTableWithParquetFiles(
        tableName,
        [parquetPath],
        columnTypeOverrides
      );
    } catch (error) {
      this.logger.error(`Failed to process Parquet file ${parquetPath}:`, error);
      throw error;
    }
  }

  private async prepareTableForParquetFiles(
    tableName: string,
    parquetPaths: string[],
    columnTypeOverrides: Record<string, string>
  ): Promise<void> {
    let tableExists = await this.databaseService.checkTableExists(tableName);

    for (const parquetPath of parquetPaths) {
      const fileExists = await this.fileOperationsService.fileExists(
        parquetPath
      );
      if (!fileExists) {
        throw new Error(`Parquet file not found: ${parquetPath}`);
      }

      const fileSize = await this.fileOperationsService.getFileSize(
        parquetPath
      );
      this.logger.debug(
        `Parquet file size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`
      );

      if (!tableExists) {
        this.logger.log(
          `Table ${tableName} does not exist, creating from Parquet structure`
        );
        await this.databaseService.createTableFromDataFileWithTypes(
          tableName,
          parquetPath,
          columnTypeOverrides
        );
        tableExists = true;
      } else {
        this.logger.log(
          `Table ${tableName} exists, checking column compatibility`
        );

        await this.databaseService.ensureTableMatchesDataFile(
          tableName,
          parquetPath,
          columnTypeOverrides
        );
      }
    }
  }

  private async replaceTableWithParquetFiles(
    tableName: string,
    parquetPaths: string[],
    columnTypeOverrides: Record<string, string>
  ): Promise<number> {
    const recordCount = await this.databaseService.importParquetFilesWithRust(
      tableName,
      parquetPaths,
      columnTypeOverrides
    );
    await this.databaseService.markTableForMapFeaturesEtl(tableName);
    return recordCount;
  }
}
