import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';

import { DataCategory } from '../types/data-import.types';

import { DataCategoryConfig } from '../config/data-category.config';

import { FileOperationsService } from './file-operations.service';
import { DatabaseService } from './database.service';
import { CsvTransformationService } from './csv-transformation.service';

interface PreparedCsvFile {
  originalPath: string;
  transformedPath: string;
}
@Injectable()
export class CsvProcessingService {
  private readonly logger = new Logger(CsvProcessingService.name);

  constructor(
    private readonly fileOperationsService: FileOperationsService,
    private readonly databaseService: DatabaseService,
    private readonly csvTransformationService: CsvTransformationService
  ) {}
  async importCsvToDatabase(
    csvDir: string,
    category: DataCategory,
    year: number
  ): Promise<number> {
    try {
      const files = await fs.readdir(csvDir);
      const csvFiles = DataCategoryConfig.filterCsvFilesForCategory(
        files
          .filter(
            (file) =>
              file.endsWith('.csv') && !file.endsWith('_transformed.csv')
          )
          .sort(),
        category
      );

      if (csvFiles.length === 0) {
        throw new Error(
          `No CSV files matched category ${category.name} in ${csvDir}`
        );
      }

      const tableName = DataCategoryConfig.getTableName(category, year);
      const csvPaths = csvFiles.map((csvFile) => path.join(csvDir, csvFile));
      const columnTypeOverrides =
        DataCategoryConfig.getColumnTypeOverrides(category);

      await this.prepareTableForCsvFiles(
        tableName,
        csvPaths,
        columnTypeOverrides
      );

      return await this.replaceTableWithCsvFiles(
        tableName,
        csvPaths,
        columnTypeOverrides
      );
    } catch (error) {
      this.logger.error(
        `Failed to import CSV files for ${category.name} ${year}:`,
        error
      );
      throw error;
    }
  }
  async importSingleCsvFile(
    csvPath: string,
    category: DataCategory,
    year: number
  ): Promise<number> {
    const tableName = DataCategoryConfig.getTableName(category, year);
    const columnTypeOverrides =
      DataCategoryConfig.getColumnTypeOverrides(category);

    this.logger.log(`Importing ${csvPath} to table ${tableName}`);

    try {
      await this.prepareTableForCsvFiles(
        tableName,
        [csvPath],
        columnTypeOverrides
      );

      return await this.replaceTableWithCsvFiles(
        tableName,
        [csvPath],
        columnTypeOverrides
      );
    } catch (error) {
      this.logger.error(`Failed to process CSV file ${csvPath}:`, error);
      throw error;
    }
  }
  async importSingleCsvFileReplacingImlMonth(
    csvPath: string,
    category: DataCategory,
    year: number,
    month: number
  ): Promise<number> {
    const tableName = DataCategoryConfig.getTableName(category, year);
    const columnTypeOverrides =
      DataCategoryConfig.getColumnTypeOverrides(category);

    await this.prepareTableForCsvFiles(
      tableName,
      [csvPath],
      columnTypeOverrides
    );
    const preparedCsvFile = await this.prepareCsvFileForImport(
      csvPath,
      tableName,
      columnTypeOverrides
    );

    try {
      const recordCount = await this.databaseService.runImportTransaction(
        async (db) => {
          await this.databaseService.deleteImlMonthRows(
            tableName,
            year,
            month,
            db
          );
          return await this.databaseService.importCsvWithCopy(
            tableName,
            preparedCsvFile.transformedPath,
            db
          );
        }
      );
      await this.databaseService.markTableForMapFeaturesEtl(tableName);
      return recordCount;
    } finally {
      await this.cleanupPreparedCsvFiles([preparedCsvFile]);
    }
  }

  private async prepareTableForCsvFiles(
    tableName: string,
    csvPaths: string[],
    columnTypeOverrides: Record<string, string>
  ): Promise<void> {
    let tableExists = await this.databaseService.checkTableExists(tableName);

    for (const csvPath of csvPaths) {
      const fileExists = await this.fileOperationsService.fileExists(csvPath);
      if (!fileExists) {
        throw new Error(`CSV file not found: ${csvPath}`);
      }

      const fileSize = await this.fileOperationsService.getFileSize(csvPath);
      this.logger.debug(
        `CSV file size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`
      );

      if (!tableExists) {
        this.logger.log(
          `Table ${tableName} does not exist, creating from CSV structure`
        );
        await this.databaseService.createTableFromCSVWithTypes(
          tableName,
          csvPath,
          columnTypeOverrides
        );
        tableExists = true;
      } else {
        this.logger.log(
          `Table ${tableName} exists, checking column compatibility`
        );

        const existingColumns = await this.databaseService.getTableColumns(
          tableName
        );
        this.logger.debug(
          `Existing table columns (${
            existingColumns.length
          }): ${existingColumns.join(', ')}`
        );

        await this.databaseService.ensureTableMatchesCSV(
          tableName,
          csvPath,
          columnTypeOverrides
        );

        const updatedColumns = await this.databaseService.getTableColumns(
          tableName
        );
        this.logger.debug(
          `Updated table columns (${
            updatedColumns.length
          }): ${updatedColumns.join(', ')}`
        );
      }
    }
  }

  private async replaceTableWithCsvFiles(
    tableName: string,
    csvPaths: string[],
    columnTypeOverrides: Record<string, string>
  ): Promise<number> {
    const preparedCsvFiles: PreparedCsvFile[] = [];

    try {
      for (const csvPath of csvPaths) {
        preparedCsvFiles.push(
          await this.prepareCsvFileForImport(
            csvPath,
            tableName,
            columnTypeOverrides
          )
        );
      }

      const totalRecords = await this.databaseService.runImportTransaction(
        async (db) => {
          // Replace the target table once, after every sheet has contributed schema.
          await this.databaseService.truncateTable(tableName, db);

          let importedRecords = 0;
          for (const preparedCsvFile of preparedCsvFiles) {
            importedRecords += await this.databaseService.importCsvWithCopy(
              tableName,
              preparedCsvFile.transformedPath,
              db
            );
          }

          return importedRecords;
        }
      );
      await this.databaseService.markTableForMapFeaturesEtl(tableName);
      return totalRecords;
    } finally {
      await this.cleanupPreparedCsvFiles(preparedCsvFiles);
    }
  }

  private async prepareCsvFileForImport(
    csvPath: string,
    tableName: string,
    columnTypeOverrides: Record<string, string>
  ): Promise<PreparedCsvFile> {
    const transformedPath =
      await this.csvTransformationService.transformCsvForDatabase(
        csvPath,
        tableName,
        columnTypeOverrides
      );

    return {
      originalPath: csvPath,
      transformedPath,
    };
  }

  private async cleanupPreparedCsvFiles(
    preparedCsvFiles: PreparedCsvFile[]
  ): Promise<void> {
    for (const preparedCsvFile of preparedCsvFiles) {
      if (preparedCsvFile.transformedPath === preparedCsvFile.originalPath) {
        continue;
      }

      try {
        await this.fileOperationsService.cleanup(preparedCsvFile.transformedPath);
      } catch (error) {
        this.logger.warn(
          `Failed to cleanup transformed CSV file ${preparedCsvFile.transformedPath}:`,
          error
        );
      }
    }
  }
}
