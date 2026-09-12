import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as path from 'node:path';

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

export type FileCheck = { hash: string; size: number; filePath: string };
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
    const { year: currentYear, month: currentMonth } =
      this.getBusinessDateParts(new Date());
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
        currentMonth,
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
        `Could not verify current source for ${
          category.name
        } ${year}: ${getErrorMessage(error)}`
      );
      return {
        shouldImport: false,
        reason: 'Could not verify file for current year; source skipped',
        retryable: true,
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
    currentMonth: number,
    existingMetadata: FileMetadata | null,
    fileCheckCache: FileCheckCache
  ): Promise<ImportDecision> {
    if (!existingMetadata) {
      return {
        shouldImport: true,
        reason: `${year} data has rows but no trusted import metadata`,
      };
    }

    if (
      !this.shouldRefreshPreviousYearForDelayedReporting(
        year,
        currentYear,
        currentMonth
      )
    ) {
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
    currentYear: number,
    currentMonth: number
  ): boolean {
    return (
      year === currentYear - 1 && (currentMonth === 0 || currentMonth === 1)
    );
  }

  private getBusinessDateParts(now: Date): { year: number; month: number } {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: 'numeric',
    }).formatToParts(now);
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const month =
      Number(parts.find((part) => part.type === 'month')?.value) - 1;

    if (!Number.isInteger(year) || !Number.isInteger(month)) {
      throw new Error('Could not resolve the São Paulo business date');
    }

    return { year, month };
  }
  private async verifyFileChanges(
    category: DataCategory,
    year: number,
    existingMetadata: FileMetadata,
    fileCheckCache: FileCheckCache
  ): Promise<ImportDecision> {
    const url = DataCategoryConfig.getUrl(category, year);

    try {
      const { hash: newHash, size: newSize } = await this.getFileCheck(
        url,
        fileCheckCache
      );

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
        `Could not verify historical source for ${
          category.name
        } ${year}: ${getErrorMessage(error)}`
      );
      return {
        shouldImport: false,
        reason: `Could not verify file for ${year}; source skipped`,
        retryable: true,
      };
    }
  }
  async checkMultipleYears(
    category: DataCategory,
    fileCheckCache: FileCheckCache = new Map()
  ): Promise<
    Array<{
      year: number;
      shouldImport: boolean;
      reason: string;
      retryable?: boolean;
    }>
  > {
    const results: Array<{
      year: number;
      shouldImport: boolean;
      reason: string;
      retryable?: boolean;
    }> = [];
    for (const year of category.years) {
      try {
        const { shouldImport, reason, retryable } = await this.shouldImportData(
          category,
          year,
          fileCheckCache
        );
        this.logger.log(`${category.name} ${year}: ${reason}`);
        results.push({
          year,
          shouldImport,
          reason,
          ...(retryable ? { retryable: true } : {}),
        });
      } catch (error) {
        this.logger.error(
          `Error checking import requirements for ${category.name} ${year}:`,
          error
        );
        results.push({
          year,
          shouldImport: false,
          reason: `Check failed; source skipped: ${getErrorMessage(error)}`,
          retryable: true,
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

    const filePath = path.join(
      process.cwd(),
      'temp',
      'decision-cache',
      `${crypto.createHash('sha256').update(url).digest('hex')}.download`
    );
    const check = this.fileOperationsService
      .downloadFileAndHash(url, filePath)
      .then((result) => ({ ...result, filePath }));
    fileCheckCache.set(url, check);
    return check;
  }
}
