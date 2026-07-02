import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';

import { DataCategory, FileMetadata } from './types/data-import.types';

import { DataCategoryConfig } from './config/data-category.config';

import { FileOperationsService } from './services/file-operations.service';
import { RustToolService } from './services/rust-tool.service';
import { MetadataService } from './services/metadata.service';
import { ParquetProcessingService } from './services/parquet-processing.service';
import { ImportDecisionService } from './services/import-decision.service';
import type { FileCheckCache } from './services/import-decision.service';
import { ImportStatusService } from './services/import-status.service';
import { getErrorMessage } from '../shared/error.utils';
import { ImlImportService } from './services/iml-import.service';
import {
  CategoryProcessResult,
  ImportGroupResult,
  ImportIoLimiter,
  ImportTarget,
  ImportUrlGroup,
} from './types/import-orchestration.types';
import {
  createImportConcurrencyLimiter,
  processWithConcurrency,
} from './utils/import-concurrency.utils';

const DATASET_HANDLING_PARALLELIZATION = 1;

@Injectable()
export class DataImportService {
  private readonly logger = new Logger(DataImportService.name);
  private readonly tempDir = path.join(process.cwd(), 'temp');
  private readonly tempDirReady: Promise<void>;

  private readonly maxConcurrentImportOperations =
    DATASET_HANDLING_PARALLELIZATION;

  constructor(
    private readonly fileOperationsService: FileOperationsService,
    private readonly rustToolService: RustToolService,
    private readonly metadataService: MetadataService,
    private readonly parquetProcessingService: ParquetProcessingService,
    private readonly importDecisionService: ImportDecisionService,
    private readonly importStatusService: ImportStatusService,
    private readonly imlImportService: ImlImportService
  ) {
    this.tempDirReady = this.ensureTempDir();
    this.tempDirReady.catch((error) => {
      this.logger.warn(
        `Failed to initialize temp directory ${this.tempDir}: ${getErrorMessage(
          error
        )}`
      );
    });
    // Check Rust tool availability on startup (don't await to avoid blocking)
    this.rustToolService.ensureRustTool().catch((error) => {
      this.logger.warn(
        `Rust tool check failed at startup: ${getErrorMessage(error)}`
      );
    });
  }

  private async ensureTempDir(): Promise<void> {
    await this.fileOperationsService.ensureDirectory(this.tempDir);
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
  getDataCategories(): DataCategory[] {
    return DataCategoryConfig.getDataCategories();
  }
  async getImportStatus() {
    return await this.importStatusService.getImportStatus();
  }
  async getImportStatistics() {
    return await this.importStatusService.getImportStatistics();
  }
  async getTablesNeedingAttention() {
    return await this.importStatusService.getTablesNeedingAttention();
  }
  async importAllCategories(): Promise<void> {
    this.logger.log('Starting resource-efficient auto-import check...');

    const validCategories = DataCategoryConfig.getDirectCategories();
    const fileCheckCache: FileCheckCache = new Map();

    const targetGroups = await processWithConcurrency(
      validCategories,
      this.maxConcurrentImportOperations,
      async (category): Promise<ImportTarget[]> => {
        const decisions = await this.importDecisionService.checkMultipleYears(
          category,
          fileCheckCache
        );

        return decisions
          .filter((decision) => decision.shouldImport)
          .map((decision) => ({ category, year: decision.year }));
      }
    );

    const targets = targetGroups.flat();

    this.logger.log(
      `Auto-import: ${targets.length} category/year target(s) need updates`
    );

    await this.importTargetsOptimized(targets);
    try {
      await this.imlImportService.importWithIntelligentLogic();
    } catch (error) {
      this.logger.warn(
        `Low-priority IML import failed after primary imports completed: ${getErrorMessage(
          error
        )}`
      );
    }
  }
  private async importTargetsOptimized(targets: ImportTarget[]): Promise<void> {
    if (targets.length === 0) return;

    await this.tempDirReady;

    const urlGroups = new Map<string, ImportUrlGroup>();

    for (const { category, year } of targets) {
      const url = DataCategoryConfig.getUrl(category, year);

      if (!urlGroups.has(url)) {
        urlGroups.set(url, { url, year, categories: [] });
      }
      const group = urlGroups.get(url);
      if (group) {
        group.categories.push(category);
      }
    }

    this.logger.log(
      `Optimized import: ${urlGroups.size} unique file(s) for ${targets.length} category/year target(s)`
    );

    const groups = Array.from(urlGroups.values()).sort((left, right) => {
      const categoryCountDelta =
        right.categories.length - left.categories.length;
      if (categoryCountDelta !== 0) {
        return categoryCountDelta;
      }

      const yearDelta = right.year - left.year;
      if (yearDelta !== 0) {
        return yearDelta;
      }

      return left.url.localeCompare(right.url);
    });
    const ioLimiter = createImportConcurrencyLimiter(
      this.maxConcurrentImportOperations
    );

    this.logger.log(
      `Starting parallel processing with max ${this.maxConcurrentImportOperations} concurrent I/O operations...`
    );

    const groupResults = await processWithConcurrency(
      groups,
      this.maxConcurrentImportOperations,
      async (group): Promise<ImportGroupResult> => {
        this.logger.log(
          `Downloading file: ${group.url} for ${group.categories.length} categories`
        );

        try {
          await this.importFromSingleFile(
            group.url,
            group.year,
            group.categories,
            ioLimiter
          );
          return {
            success: true,
            url: group.url,
            categories: group.categories.length,
          };
        } catch (error) {
          const errorMessage = this.getErrorMessage(error);
          this.logger.error(`Failed to import from ${group.url}:`, error);
          return {
            success: false,
            url: group.url,
            categories: group.categories.length,
            error: errorMessage,
          };
        }
      }
    );

    const successCount = groupResults.filter((result) => result.success).length;
    const failureCount = groupResults.length - successCount;
    this.logger.log(
      `Import groups completed: ${successCount} successful, ${failureCount} failed`
    );

    if (failureCount > 0) {
      const failedUrls = groupResults
        .filter((result) => !result.success)
        .map((result) => result.url);
      this.logger.warn(`Failed URLs: ${failedUrls.join(', ')}`);
    }

    this.logger.log(
      `Import process completed for ${targets.length} category/year target(s) across ${urlGroups.size} unique file(s)`
    );
  }
  async importAllData(): Promise<void> {
    this.logger.log('Starting full parallel data import...');

    const validCategories = DataCategoryConfig.getDirectCategories();
    const targets = validCategories.flatMap((category) =>
      category.years.map((year) => ({ category, year }))
    );
    this.logger.log(
      `Will import ${targets.length} category/year target(s)...`
    );

    await this.importTargetsOptimized(targets);
    await this.imlImportService.importAllData();

    this.logger.log('Full parallel data import completed');
  }
  async importDataCategoryWithIntelligentLogic(
    category: DataCategory
  ): Promise<number> {
    if (category.importStrategy === 'ssp-iml') {
      return await this.imlImportService.importCategory(category);
    }

    this.logger.log(
      `Checking ${category.name} with parallel intelligent import logic...`
    );

    // Check all years in parallel to determine what needs importing
    const yearChecks = await this.importDecisionService.checkMultipleYears(
      category
    );
    const yearsToImport = yearChecks.filter((check) => check.shouldImport);

    if (yearsToImport.length === 0) {
      this.logger.log(`No imports needed for ${category.name}`);
      return 0;
    }

    this.logger.log(
      `${category.name}: Found ${yearsToImport.length} years needing import`
    );

    let importedCount = 0;
    const failures: string[] = [];
    for (const { year } of yearsToImport) {
      try {
        this.logger.log(`Importing ${category.name} for year ${year}...`);
        await this.importDataForYear(category, year);
        this.logger.log(`Successfully imported ${category.name} ${year}`);
        importedCount++;
      } catch (error) {
        this.logger.error(
          `Failed to import ${category.name} for year ${year}:`,
          error
        );
        failures.push(`${year}: ${this.getErrorMessage(error)}`);
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `Failed to import ${failures.length}/${yearsToImport.length} year(s) for ${category.name}: ${failures.join('; ')}`
      );
    }

    this.logger.log(
      `Imported data to ${importedCount} tables for ${category.name}`
    );

    return importedCount;
  }
  async importDataCategory(category: DataCategory): Promise<void> {
    if (category.importStrategy === 'ssp-iml') {
      await this.imlImportService.importCategory(category, true);
      return;
    }

    this.logger.log(`Starting import for ${category.name}`);

    const failures: string[] = [];
    for (const year of category.years) {
      try {
        await this.importDataForYear(category, year);
      } catch (error) {
        this.logger.error(
          `Failed to import ${category.name} for year ${year}:`,
          error
        );
        failures.push(`${year}: ${this.getErrorMessage(error)}`);
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `Failed to import ${failures.length}/${category.years.length} year(s) for ${category.name}: ${failures.join('; ')}`
      );
    }
  }
  private async importDataForYear(
    category: DataCategory,
    year: number
  ): Promise<void> {
    const url = DataCategoryConfig.getUrl(category, year);
    const fileName = `${category.tablePrefix}_${year}.xlsx`;
    const filePath = path.join(this.tempDir, fileName);
    const parquetDir = path.join(
      this.tempDir,
      `${category.tablePrefix}_${year}_parquet`
    );

    await this.tempDirReady;
    this.logger.log(`Downloading ${url}...`);

    try {
      await this.fileOperationsService.downloadFile(url, filePath);

      const fileHash = await this.fileOperationsService.calculateFileHash(
        filePath
      );
      const fileSize = await this.fileOperationsService.getFileSize(filePath);

      // Convert Excel to Parquet using Rust tool
      await this.rustToolService.convertExcelToParquet(filePath, parquetDir);

      const recordCount =
        await this.parquetProcessingService.importParquetToDatabase(
          parquetDir,
          category,
          year
        );

      const metadata: FileMetadata = {
        category: category.name,
        year: year,
        fileUrl: url,
        fileHash: fileHash,
        fileSize: fileSize,
        lastDownloaded: new Date(),
        lastImported: new Date(),
        recordCount: recordCount,
      };
      await this.metadataService.saveFileMetadata(metadata);
    } catch (error) {
      const errorMessage = getErrorMessage(error);

      if (
        errorMessage.includes('Rust tool') ||
        errorMessage.includes('cargo build')
      ) {
        throw new Error(
          `Excel to Parquet conversion failed: ${errorMessage}. ` +
            `To fix this issue:\n` +
            `1. Ensure Rust is installed (https://rustup.rs/)\n` +
            `2. Navigate to ${this.rustToolService.getRustToolPath()}\n` +
            `3. Run 'cargo build'\n` +
            `4. Restart the application`
        );
      }

      throw error;
    } finally {
      await this.fileOperationsService.cleanup(filePath);
      await this.fileOperationsService.cleanup(undefined, parquetDir);
    }
  }
  private async importFromSingleFile(
    url: string,
    year: number,
    categories: DataCategory[],
    ioLimiter: ImportIoLimiter
  ): Promise<void> {
    const primaryCategory = categories[0];
    const fileName = `${primaryCategory.tablePrefix}_${year}.xlsx`;
    const filePath = path.join(this.tempDir, fileName);

    this.logger.log(
      `Downloading ${fileName} for ${
        categories.length
      } categories: ${categories.map((c) => c.name).join(', ')}`
    );

    let fileHash = '';
    let fileSize = 0;

    try {
      // Download attempts are timed out inside FileOperationsService.
      const downloadStart = Date.now();
      await ioLimiter(() =>
        this.fileOperationsService.downloadFile(url, filePath)
      );
      const downloadTime = Date.now() - downloadStart;

      this.logger.log(
        `Download completed in ${(downloadTime / 1000).toFixed(1)}s`
      );

      // Hash and size checks are awaited directly so cleanup cannot overlap them.
      [fileHash, fileSize] = await ioLimiter(() =>
        Promise.all([
          this.fileOperationsService.calculateFileHash(filePath),
          this.fileOperationsService.getFileSize(filePath),
        ])
      );

      this.logger.log(
        `Downloaded ${fileName} (${(fileSize / 1024 / 1024).toFixed(
          2
        )} MB, hash: ${fileHash.substring(0, 8)}...)`
      );
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      try {
        await this.fileOperationsService.cleanup(filePath);
      } catch (cleanupError) {
        this.logger.warn(
          `Failed to cleanup ${filePath} after download error:`,
          cleanupError
        );
      }

      throw new Error(
        `Failed to download or process ${fileName}: ${errorMessage}`
      );
    }

    let successCount = 0;
    const categoriesToProcess = categories;

    try {
      const parquetDir = path.join(
        this.tempDir,
        `${primaryCategory.tablePrefix}_${year}_shared_parquet`
      );

      this.logger.log(
        `Converting ${fileName} once for ${categoriesToProcess.length} categories`
      );
      await ioLimiter(() =>
        this.rustToolService.convertExcelToParquet(filePath, parquetDir)
      );

      this.logger.log(
        `Processing ${categoriesToProcess.length} categories with shared ${this.maxConcurrentImportOperations}-slot I/O limit...`
      );

      const categoryResults: CategoryProcessResult[] = await Promise.all(
        categoriesToProcess.map((category) =>
          ioLimiter(async () => {
            try {
              this.logger.log(
                `Processing ${category.name} from ${fileName}`
              );

              const processingStart = Date.now();

              const recordCount =
                await this.parquetProcessingService.importParquetToDatabase(
                  parquetDir,
                  category,
                  year
                );

              const metadata: FileMetadata = {
                category: category.name,
                year: year,
                fileUrl: url,
                fileHash: fileHash,
                fileSize: fileSize,
                recordCount: recordCount,
                lastDownloaded: new Date(),
                lastImported: new Date(),
              };
              await this.metadataService.saveFileMetadata(metadata);

              const processingTime = Date.now() - processingStart;
              this.logger.log(
                `Successfully imported ${
                  category.name
                } (${recordCount} records) in ${(
                  processingTime / 1000
                ).toFixed(1)}s`
              );

              return {
                success: true,
                category: category.name,
                recordCount,
              };
            } catch (error) {
              const errorMessage = this.getErrorMessage(error);
              this.logger.error(
                `Failed to process ${category.name} from ${fileName}:`,
                error
              );

              return {
                success: false,
                category: category.name,
                error: errorMessage,
              };
            }
          })
        )
      );

      const categorySuccessCount = categoryResults.filter(
        (result) => result.success
      ).length;
      successCount += categorySuccessCount;

      this.logger.log(
        `Category processing completed: ${categorySuccessCount} imported, ${
          categoriesToProcess.length - categorySuccessCount
        } failed`
      );

      const failedResults = categoryResults.filter((result) => !result.success);
      if (failedResults.length > 0) {
        throw new Error(
          `Failed to process ${failedResults.length}/${categoriesToProcess.length} category/categories from ${fileName}: ${failedResults
            .map(
              (result) =>
                `${result.category}: ${result.error ?? 'unknown error'}`
            )
            .join('; ')}`
        );
      }
    } catch (error) {
      this.logger.error(
        `Error during category processing for ${fileName}:`,
        error
      );
      throw error;
    } finally {
      const parquetDir = path.join(
        this.tempDir,
        `${primaryCategory.tablePrefix}_${year}_shared_parquet`
      );

      try {
        await this.fileOperationsService.cleanup('', parquetDir);
        this.logger.log(`Cleaned up Parquet directory for ${fileName}`);
      } catch (cleanupError) {
        this.logger.warn(
          `Failed to cleanup Parquet directory for ${fileName}:`,
          cleanupError
        );
      }

      try {
        await this.fileOperationsService.cleanup(filePath);
        this.logger.log(`Cleaned up downloaded file: ${fileName}`);
      } catch (cleanupError) {
        this.logger.warn(
          `Failed to cleanup downloaded file ${fileName}:`,
          cleanupError
        );
      }
    }

    if (successCount === categories.length) {
      this.logger.log(
        `Successfully completed processing ${fileName}: ${successCount} imported`
      );
    } else if (successCount > 0) {
      this.logger.warn(
        `Partially completed processing ${fileName}: ${successCount} imported, ${
          categories.length - successCount
        } failed`
      );
    } else {
      this.logger.error(
        `Failed to process ${fileName}: 0/${categories.length} categories successful`
      );
    }
  }
}
