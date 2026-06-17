import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { z } from 'zod';
import { getErrorMessage } from '../../shared/error.utils';
import { DataCategoryConfig } from '../config/data-category.config';
import {
  DataCategory,
  ImlFileMetadata,
} from '../types/data-import.types';
import { CsvProcessingService } from './csv-processing.service';
import { DatabaseService } from './database.service';
import { FileOperationsService } from './file-operations.service';
import { MetadataService } from './metadata.service';
import { PythonToolService } from './python-tool.service';

const scraperFileSchema = z
  .object({
    month: z.number().int().min(1).max(12),
    recordCount: z.number().int().nonnegative(),
    outputPath: z.string().min(1),
  })
  .strict();

const scraperResultSchema = z
  .object({
    year: z.number().int(),
    files: z.array(scraperFileSchema),
  })
  .strict();

interface ImlMonth {
  year: number;
  month: number;
}

interface ImlMonthTarget extends ImlMonth {
  existsInDatabase: boolean;
}

type ScraperFile = z.infer<typeof scraperFileSchema>;
const IML_TIME_ZONE = 'America/Sao_Paulo';

@Injectable()
export class ImlImportService {
  private readonly logger = new Logger(ImlImportService.name);
  private readonly tempDir = path.join(process.cwd(), 'temp', 'iml');
  private readonly scraperTimeoutMs = this.getPositiveIntegerEnv(
    'IML_SCRAPER_TIMEOUT_MS',
    3_600_000,
    300_000,
    7_200_000
  );
  private readonly delaySeconds = this.getPositiveNumberEnv(
    'IML_SCRAPER_DELAY_SECONDS',
    1
  );

  constructor(
    private readonly pythonToolService: PythonToolService,
    private readonly fileOperationsService: FileOperationsService,
    private readonly csvProcessingService: CsvProcessingService,
    private readonly databaseService: DatabaseService,
    private readonly metadataService: MetadataService
  ) {}

  async importWithIntelligentLogic(): Promise<number> {
    return await this.importMonths(false);
  }

  async importAllData(): Promise<number> {
    return await this.importMonths(true);
  }

  async importCategory(category: DataCategory, force = false): Promise<number> {
    if (category.importStrategy !== 'ssp-iml') {
      throw new Error(`${category.name} is not an IML scraper category`);
    }

    return await this.importMonths(force, category);
  }

  private async importMonths(
    force: boolean,
    category = DataCategoryConfig.getImlCategory()
  ): Promise<number> {
    await this.fileOperationsService.ensureDirectory(this.tempDir);
    const targets = await this.getMonthTargets(category, force);
    const targetsByYear = this.groupTargetsByYear(targets);
    const failures: string[] = [];
    let importedMonths = 0;

    this.logger.log(
      `Starting low-priority IML import for ${targets.length} month(s)`
    );

    for (const [year, yearTargets] of targetsByYear) {
      const outputDir = path.join(this.tempDir, String(year));
      try {
        await this.fileOperationsService.ensureDirectory(outputDir);
        const result = await this.runScraper(
          year,
          yearTargets.map((target) => target.month),
          outputDir
        );
        const filesByMonth = new Map(
          result.files.map((file) => [file.month, file])
        );

        for (const target of yearTargets) {
          try {
            const file = filesByMonth.get(target.month);
            if (!file) {
              throw new Error(
                `Scraper did not return ${this.formatMonth(target)}`
              );
            }
            if (await this.processMonth(category, target, file)) {
              importedMonths++;
            }
          } catch (error) {
            const message = getErrorMessage(error);
            failures.push(`${this.formatMonth(target)}: ${message}`);
            this.logger.error(
              `Failed to import IML data for ${this.formatMonth(target)}:`,
              error
            );
          }
        }

        const tableName = DataCategoryConfig.getTableName(category, year);
        if (
          (await this.databaseService.checkTableExists(tableName)) &&
          (await this.databaseService.hasTableRows(tableName))
        ) {
          await this.databaseService.ensureImlLookupIndex(tableName);
          await this.databaseService.markTableAsNonGeographic(tableName);
        }
      } catch (error) {
        const message = getErrorMessage(error);
        failures.push(`${year}: ${message}`);
        this.logger.error(`Failed to scrape IML data for ${year}:`, error);
      } finally {
        await this.fileOperationsService.cleanup(undefined, outputDir);
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `Failed to import ${failures.length}/${targets.length} IML month(s): ${failures.join(
          '; '
        )}`
      );
    }

    this.logger.log(
      `Low-priority IML import completed: ${importedMonths} month(s) updated`
    );
    return importedMonths;
  }

  private async getMonthTargets(
    category: DataCategory,
    force: boolean,
    now = new Date()
  ): Promise<ImlMonthTarget[]> {
    const refreshMonths = new Set(
      this.getScheduledRefreshMonths(now).map((month) => this.monthKey(month))
    );
    const availableMonths = this.getAvailableMonths(category, now);
    const monthsByYear = this.groupMonthsByYear(availableMonths);
    const targets: ImlMonthTarget[] = [];

    for (const [year, months] of monthsByYear) {
      const tableName = DataCategoryConfig.getTableName(category, year);
      const tableExists = await this.databaseService.checkTableExists(tableName);
      const importedMonths = tableExists
        ? await this.databaseService.getImlImportedMonths(tableName)
        : new Set<number>();
      const metadataMonths = new Set(
        (
          await this.metadataService.getImlFileMetadataByYear(
            category.name,
            year
          )
        ).map((metadata) => metadata.month)
      );

      for (const month of months) {
        const existsInDatabase = importedMonths.has(month);
        if (
          force ||
          !existsInDatabase ||
          !metadataMonths.has(month) ||
          refreshMonths.has(this.monthKey({ year, month }))
        ) {
          targets.push({ year, month, existsInDatabase });
        }
      }
    }

    return targets;
  }

  private getAvailableMonths(category: DataCategory, now: Date): ImlMonth[] {
    const firstYear = Math.min(...category.years);
    const current = this.getCurrentMonth(now);
    const months: ImlMonth[] = [];

    for (let year = firstYear; year <= current.year; year++) {
      const maxMonth = year === current.year ? current.month : 12;
      for (let month = 1; month <= maxMonth; month++) {
        months.push({ year, month });
      }
    }

    return months;
  }

  private getScheduledRefreshMonths(now: Date): ImlMonth[] {
    const current = this.getCurrentMonth(now);
    return Array.from({ length: 3 }, (_, monthsAgo) => {
      const date = new Date(
        Date.UTC(current.year, current.month - 1 - monthsAgo, 1)
      );
      return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
      };
    });
  }

  private getCurrentMonth(now: Date): ImlMonth {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: IML_TIME_ZONE,
      year: 'numeric',
      month: 'numeric',
    }).formatToParts(now);
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const month = Number(parts.find((part) => part.type === 'month')?.value);

    if (!Number.isInteger(year) || !Number.isInteger(month)) {
      throw new Error(`Could not determine current month in ${IML_TIME_ZONE}`);
    }
    return { year, month };
  }

  private async processMonth(
    category: DataCategory,
    target: ImlMonthTarget,
    file: ScraperFile
  ): Promise<boolean> {
    if (file.recordCount === 0) {
      throw new Error(`IML export for ${this.formatMonth(target)} is empty`);
    }

    const [fileHash, fileSize, existingMetadata] = await Promise.all([
      this.fileOperationsService.calculateFileHash(file.outputPath),
      this.fileOperationsService.getFileSize(file.outputPath),
      this.metadataService.getImlFileMetadata(
        category.name,
        target.year,
        target.month
      ),
    ]);

    if (target.existsInDatabase && existingMetadata?.fileHash === fileHash) {
      await this.metadataService.saveImlFileMetadata({
        ...existingMetadata,
        fileSize,
        lastDownloaded: new Date(),
        recordCount: file.recordCount,
      });
      this.logger.log(`IML ${this.formatMonth(target)} is unchanged`);
      return false;
    }

    const recordCount =
      await this.csvProcessingService.importSingleCsvFileReplacingImlMonth(
        file.outputPath,
        category,
        target.year,
        target.month
      );
    const metadata: ImlFileMetadata = {
      category: category.name,
      year: target.year,
      month: target.month,
      fileUrl: `${category.baseUrl}#${this.formatMonth(target)}`,
      fileHash,
      fileSize,
      lastDownloaded: new Date(),
      lastImported: new Date(),
      recordCount,
    };
    await this.metadataService.saveImlFileMetadata(metadata);

    this.logger.log(
      `Imported ${recordCount} IML records for ${this.formatMonth(target)}`
    );
    return true;
  }

  private async runScraper(
    year: number,
    months: number[],
    outputDir: string
  ): Promise<z.infer<typeof scraperResultSchema>> {
    const result = await this.pythonToolService.runAssetScript(
      'ssp_iml_scraper.py',
      [
        '--year',
        String(year),
        '--months',
        months.join(','),
        '--output-dir',
        outputDir,
        '--delay-seconds',
        String(this.delaySeconds),
        '--timeout-seconds',
        String(Math.floor(this.scraperTimeoutMs / 1000)),
      ],
      this.scraperTimeoutMs
    );

    if (result.stderr) {
      this.logger.debug(result.stderr);
    }

    const parsed = scraperResultSchema.parse(JSON.parse(result.stdout));
    if (parsed.year !== year) {
      throw new Error(`IML scraper returned unexpected year ${parsed.year}`);
    }
    return parsed;
  }

  private groupTargetsByYear(
    targets: ImlMonthTarget[]
  ): Map<number, ImlMonthTarget[]> {
    const result = new Map<number, ImlMonthTarget[]>();
    for (const target of targets) {
      const yearTargets = result.get(target.year) ?? [];
      yearTargets.push(target);
      result.set(target.year, yearTargets);
    }
    return result;
  }

  private groupMonthsByYear(months: ImlMonth[]): Map<number, number[]> {
    const result = new Map<number, number[]>();
    for (const { year, month } of months) {
      const yearMonths = result.get(year) ?? [];
      yearMonths.push(month);
      result.set(year, yearMonths);
    }
    return result;
  }

  private monthKey(month: ImlMonth): string {
    return this.formatMonth(month);
  }

  private formatMonth(month: ImlMonth): string {
    return `${month.year}-${String(month.month).padStart(2, '0')}`;
  }

  private getPositiveIntegerEnv(
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

  private getPositiveNumberEnv(name: string, fallback: number): number {
    const value = Number(process.env[name] ?? fallback);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }
}
