import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';

import { DataCategory } from '../types/data-import.types';
import { DataCategoryConfig } from '../config/data-category.config';

import { FileOperationsService } from './file-operations.service';
import { DatabaseService } from './database.service';

interface ConversionSheetReport {
  sheet: string;
  rows: number;
  columns: number;
  output_path: string;
}

interface ConversionSheetFailure {
  sheet: string;
  error: string;
}

interface ConversionManifest {
  manifest_version: number;
  input_path: string;
  format: string;
  complete: boolean;
  sheets: ConversionSheetReport[];
  skipped_sheets: ConversionSheetFailure[];
}

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
    year: number,
    expectedInputPath?: string
  ): Promise<number> {
    try {
      const manifest = await this.readConversionManifest(
        parquetDir,
        category,
        expectedInputPath
      );
      const parquetPaths = this.getPublishedParquetPaths(
        manifest,
        parquetDir,
        category
      );

      const tableName = DataCategoryConfig.getTableName(category, year);
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

  private async readConversionManifest(
    parquetDir: string,
    category: DataCategory,
    expectedInputPath?: string
  ): Promise<ConversionManifest> {
    const resolvedDirectory = path.resolve(parquetDir);
    const manifestPath = await this.findManifestPath(
      resolvedDirectory,
      expectedInputPath
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as unknown;
    } catch (error) {
      throw new Error(
        `Could not read conversion manifest ${manifestPath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    if (!this.isConversionManifest(parsed)) {
      throw new Error(`Conversion manifest is invalid: ${manifestPath}`);
    }
    if (parsed.format !== 'parquet' || !parsed.complete) {
      throw new Error(
        `Conversion manifest is incomplete for ${category.name}: ${manifestPath}`
      );
    }
    if (
      expectedInputPath &&
      path.resolve(parsed.input_path) !== path.resolve(expectedInputPath)
    ) {
      throw new Error(
        `Conversion manifest input does not match the downloaded source: ${manifestPath}`
      );
    }
    if (parsed.skipped_sheets.length > 0) {
      throw new Error(
        `Conversion manifest lists skipped data sheets for ${
          category.name
        }: ${parsed.skipped_sheets.map((sheet) => sheet.sheet).join(', ')}`
      );
    }

    const sheetNames = new Set<string>();
    const outputPaths = new Set<string>();
    for (const sheet of parsed.sheets) {
      if (sheetNames.has(sheet.sheet)) {
        throw new Error(
          `Conversion manifest contains duplicate sheet ${sheet.sheet}`
        );
      }
      sheetNames.add(sheet.sheet);

      const outputPath = this.resolveManifestOutputPath(
        resolvedDirectory,
        sheet.output_path
      );
      if (outputPaths.has(outputPath)) {
        throw new Error(
          `Conversion manifest contains duplicate output ${sheet.output_path}`
        );
      }
      outputPaths.add(outputPath);

      const stats = await fs.lstat(outputPath).catch((error: unknown) => {
        throw new Error(
          `Conversion manifest output is unavailable: ${sheet.output_path} (${
            error instanceof Error ? error.message : String(error)
          })`
        );
      });
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new Error(
          `Conversion manifest output is not a regular file: ${sheet.output_path}`
        );
      }
    }

    const matchingSheets = DataCategoryConfig.filterParquetFilesForCategory(
      parsed.sheets.map((sheet) => `${sheet.sheet}.parquet`),
      category
    );
    if (matchingSheets.length === 0) {
      throw new Error(
        `No Parquet files matched category ${category.name} in conversion manifest ${manifestPath}`
      );
    }

    return parsed;
  }

  private async findManifestPath(
    parquetDir: string,
    expectedInputPath?: string
  ): Promise<string> {
    if (expectedInputPath) {
      const inputStem = path.basename(
        expectedInputPath,
        path.extname(expectedInputPath)
      );
      const expectedPath = path.join(parquetDir, `${inputStem}_manifest.json`);
      if (await this.fileOperationsService.fileExists(expectedPath)) {
        return expectedPath;
      }
      throw new Error(`Conversion manifest not found: ${expectedPath}`);
    }

    const entries = await fs.readdir(parquetDir);
    const manifests = entries
      .filter((entry) => entry.endsWith('_manifest.json'))
      .sort();
    if (manifests.length !== 1) {
      throw new Error(
        `Expected exactly one conversion manifest in ${parquetDir}, found ${manifests.length}`
      );
    }
    return path.join(parquetDir, manifests[0]);
  }

  private getPublishedParquetPaths(
    manifest: ConversionManifest,
    parquetDir: string,
    category: DataCategory
  ): string[] {
    const matchingSheets = new Set(
      DataCategoryConfig.filterParquetFilesForCategory(
        manifest.sheets.map((sheet) => `${sheet.sheet}.parquet`),
        category
      )
    );
    const paths = manifest.sheets
      .filter((sheet) => matchingSheets.has(`${sheet.sheet}.parquet`))
      .map((sheet) =>
        this.resolveManifestOutputPath(
          path.resolve(parquetDir),
          sheet.output_path
        )
      );
    return paths.sort((left, right) => left.localeCompare(right));
  }

  private resolveManifestOutputPath(
    parquetDir: string,
    outputPath: string
  ): string {
    const resolvedPath = path.resolve(
      path.isAbsolute(outputPath)
        ? outputPath
        : path.join(parquetDir, outputPath)
    );
    const relativePath = path.relative(parquetDir, resolvedPath);
    if (
      relativePath === '' ||
      path.isAbsolute(relativePath) ||
      relativePath.startsWith(`..${path.sep}`) ||
      relativePath === '..'
    ) {
      throw new Error(
        `Conversion manifest output escapes its job directory: ${outputPath}`
      );
    }
    if (!resolvedPath.endsWith('.parquet')) {
      throw new Error(
        `Conversion manifest output is not Parquet: ${outputPath}`
      );
    }
    return resolvedPath;
  }

  private isConversionManifest(value: unknown): value is ConversionManifest {
    if (!value || typeof value !== 'object') return false;
    const manifest = value as Partial<ConversionManifest>;
    return (
      Number.isInteger(manifest.manifest_version) &&
      manifest.manifest_version === 1 &&
      typeof manifest.input_path === 'string' &&
      typeof manifest.format === 'string' &&
      typeof manifest.complete === 'boolean' &&
      Array.isArray(manifest.sheets) &&
      manifest.sheets.length > 0 &&
      manifest.sheets.every(
        (sheet) =>
          !!sheet &&
          typeof sheet === 'object' &&
          typeof sheet.sheet === 'string' &&
          sheet.sheet.trim().length > 0 &&
          Number.isInteger(sheet.rows) &&
          sheet.rows >= 0 &&
          Number.isInteger(sheet.columns) &&
          sheet.columns > 0 &&
          typeof sheet.output_path === 'string' &&
          sheet.output_path.length > 0
      ) &&
      Array.isArray(manifest.skipped_sheets) &&
      manifest.skipped_sheets.every(
        (sheet) =>
          !!sheet &&
          typeof sheet === 'object' &&
          typeof sheet.sheet === 'string' &&
          sheet.sheet.trim().length > 0 &&
          typeof sheet.error === 'string'
      )
    );
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
      this.logger.error(
        `Failed to process Parquet file ${parquetPath}:`,
        error
      );
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
