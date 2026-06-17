import { Injectable, Logger } from '@nestjs/common';

import {
  DataCategory,
  ImportDecision,
  FileMetadata,
} from '../types/data-import.types';

import { DataCategoryConfig } from '../config/data-category.config';

import { FileOperationsService } from './file-operations.service';
import { DatabaseService } from './database.service';
import { MetadataService } from './metadata.service';
import { getErrorMessage } from '../../shared/error.utils';

type FileCheck = { hash: string; size: number };
export type FileCheckCache = Map<string, Promise<FileCheck>>;

@Injectable()
export class ImportDecisionService {
  private readonly logger = new Logger(ImportDecisionService.name);

  constructor(
    private readonly fileOperationsService: FileOperationsService,
    private readonly databaseService: DatabaseService,
    private readonly metadataService: MetadataService
  ) {}
  async shouldImportData(
    category: DataCategory,
    year: number,
    fileCheckCache: FileCheckCache = new Map()
  ): Promise<ImportDecision> {
    const currentYear = new Date().getFullYear();
    const tableName = DataCategoryConfig.getTableName(category, year);

    const tableExists = await this.databaseService.checkTableExists(tableName);
    if (!tableExists) {
      return {
        shouldImport: true,
        reason: `Table ${tableName} does not exist`,
      };
    }

    const existingMetadata = await this.metadataService.getFileMetadata(
      category.name,
      year
    );

    if (!(await this.databaseService.hasTableRows(tableName))) {
      return { shouldImport: true, reason: 'Table is empty' };
    }

    if (year === currentYear) {
      return await this.checkCurrentYearData(
        category,
        year,
        currentYear,
        existingMetadata,
        fileCheckCache
      );
    }

    // Rule 3: Previous years are stable, except delayed reports in Jan/Feb.
    if (year < currentYear) {
      return await this.checkPreviousYearData(
        category,
        year,
        currentYear,
        existingMetadata,
        fileCheckCache
      );
    }

    return {
      shouldImport: false,
      reason: 'Future year data not available',
    };
  }
  private async checkCurrentYearData(
    category: DataCategory,
    year: number,
    currentYear: number,
    existingMetadata: FileMetadata | null,
    fileCheckCache: FileCheckCache
  ): Promise<ImportDecision> {
    const url = DataCategoryConfig.getUrl(category, year);

    try {
      const { hash: newHash } = await this.getFileCheck(url, fileCheckCache);

      if (!existingMetadata || existingMetadata.fileHash !== newHash) {
        return {
          shouldImport: true,
          reason: `Current year ${currentYear} data has been updated`,
        };
      }

      return {
        shouldImport: false,
        reason: `Current year ${currentYear} data is up to date`,
      };
    } catch (error) {
      this.logger.warn(
        `Could not check file hash for ${category.name} ${year}: ${getErrorMessage(error)}`
      );
      return {
        shouldImport: false,
        reason: 'Could not verify file for current year',
      };
    }
  }

  /**
   * Check previous year data. Historical years with data are not refreshed,
   * except the previous year during Jan/Feb for late Oct-Dec reporting.
   */
  private async checkPreviousYearData(
    category: DataCategory,
    year: number,
    currentYear: number,
    existingMetadata: FileMetadata | null,
    fileCheckCache: FileCheckCache
  ): Promise<ImportDecision> {
    if (!existingMetadata) {
      return {
        shouldImport: false,
        reason: `${year} data already exists in database; skipping historical refresh despite missing metadata`,
      };
    }

    if (!this.shouldRefreshPreviousYearForDelayedReporting(year, currentYear)) {
      return {
        shouldImport: false,
        reason: `${year} data already exists in database; historical refresh skipped`,
      };
    }

    return await this.verifyFileChanges(
      category,
      year,
      existingMetadata,
      fileCheckCache
    );
  }

  /**
   * Late reports for October, November, and December can arrive in Jan/Feb.
   * The source file is yearly, so we refresh the previous year's file in that window.
   */
  private shouldRefreshPreviousYearForDelayedReporting(
    year: number,
    currentYear: number
  ): boolean {
    const currentMonth = this.getCurrentMonth();

    return (
      year === currentYear - 1 && (currentMonth === 0 || currentMonth === 1)
    );
  }

  private getCurrentMonth(): number {
    return new Date().getMonth();
  }
  private async verifyFileChanges(
    category: DataCategory,
    year: number,
    existingMetadata: FileMetadata,
    fileCheckCache: FileCheckCache
  ): Promise<ImportDecision> {
    const url = DataCategoryConfig.getUrl(category, year);

    try {
      const { hash: newHash, size: newSize } =
        await this.getFileCheck(url, fileCheckCache);

      if (existingMetadata.fileHash !== newHash) {
        return {
          shouldImport: true,
          reason: `${year} data has been updated (hash changed)`,
        };
      }

      await this.metadataService.saveFileMetadata({
        ...existingMetadata,
        lastDownloaded: new Date(),
        fileSize: newSize,
      });

      return {
        shouldImport: false,
        reason: `${year} data verified, no changes detected`,
      };
    } catch (error) {
      this.logger.warn(
        `Could not verify file hash for ${category.name} ${year}: ${getErrorMessage(error)}`
      );
      return {
        shouldImport: false,
        reason: `Could not verify file for ${year}`,
      };
    }
  }
  async checkMultipleYears(
    category: DataCategory,
    fileCheckCache: FileCheckCache = new Map()
  ): Promise<Array<{ year: number; shouldImport: boolean; reason: string }>> {
    const results: Array<{
      year: number;
      shouldImport: boolean;
      reason: string;
    }> = [];

    for (const year of category.years) {
      try {
        const { shouldImport, reason } = await this.shouldImportData(
          category,
          year,
          fileCheckCache
        );
        this.logger.log(`${category.name} ${year}: ${reason}`);
        results.push({ year, shouldImport, reason });
      } catch (error) {
        this.logger.error(
          `Error checking import requirements for ${category.name} ${year}:`,
          error
        );
        results.push({
          year,
          shouldImport: false,
          reason: `Check failed: ${getErrorMessage(error)}`,
        });
      }
    }

    return results;
  }

  private getFileCheck(
    url: string,
    fileCheckCache: FileCheckCache
  ): Promise<FileCheck> {
    const existing = fileCheckCache.get(url);
    if (existing) {
      return existing;
    }

    const check = this.fileOperationsService.downloadAndHash(url);
    fileCheckCache.set(url, check);
    return check;
  }
}
