import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { RustCsvAnalysis } from '../types/data-import.types';
import { getRustPostgresDatabaseUrl } from '../../prisma/database-url.util';
import { getErrorMessage } from '../../shared/error.utils';

const DATASET_HANDLING_PARALLELIZATION = 1;

@Injectable()
export class RustToolService {
  private readonly logger = new Logger(RustToolService.name);
  private activeDatasetHandlingProcesses = 0;
  private readonly datasetHandlingQueue: Array<() => void> = [];
  private readonly rustToolPath = path.resolve(
    __dirname,
    '../../../dataset-handling'
  );
  private get rustBinaryPath(): string {
    // Check if we have a pre-built binary path from environment (Docker production)
    const envBinaryPath = process.env.RUST_BINARY_PATH;
    if (envBinaryPath) {
      return envBinaryPath;
    }
    return path.join(
      this.rustToolPath,
      'target',
      'release',
      'dataset-handling'
    );
  }
  getRustToolPath(): string {
    return this.rustToolPath;
  }
  async runWithDatasetHandlingSlot<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    const release = await this.acquireDatasetHandlingSlot();

    try {
      return await operation();
    } finally {
      release();
    }
  }
  private acquireDatasetHandlingSlot(): Promise<() => void> {
    return new Promise((resolve) => {
      const start = () => {
        this.activeDatasetHandlingProcesses++;
        resolve(() => {
          this.activeDatasetHandlingProcesses--;
          const next = this.datasetHandlingQueue.shift();
          if (next) {
            next();
          }
        });
      };

      if (
        this.activeDatasetHandlingProcesses <
        DATASET_HANDLING_PARALLELIZATION
      ) {
        start();
      } else {
        this.datasetHandlingQueue.push(start);
      }
    });
  }
  async ensureRustTool(): Promise<void> {
    try {
      await fs.access(this.rustBinaryPath);
      this.logger.log(`Rust tool found at: ${this.rustBinaryPath}`);
      try {
        await fs.access(this.rustBinaryPath, require('fs').constants.X_OK);
      } catch {
        await require('fs').promises.chmod(this.rustBinaryPath, 0o755);
        this.logger.log('Made Rust tool executable');
      }
    } catch {
      // In production (Docker), the binary should be pre-built and available
      // Don't attempt to build at runtime since cargo won't be available
      throw new Error(
        `Rust tool binary not found at: ${this.rustBinaryPath}. ` +
          `In Docker/production environments, the binary should be pre-built during image build. ` +
          `Please ensure the Rust tool is properly built and included in the Docker image.`
      );
    }
  }
  /**
   * Check if Rust tool is available without attempting to build
   * This is safer for Docker environments where cargo is not available
   */
  async isRustToolAvailable(): Promise<boolean> {
    try {
      this.logger.debug(`Checking Rust binary availability`);
      this.logger.verbose(`Rust binary path: ${this.rustBinaryPath}`);

      await fs.access(this.rustBinaryPath);
      this.logger.verbose('Rust binary file exists');

      await fs.access(this.rustBinaryPath, require('fs').constants.X_OK);
      this.logger.verbose('Rust binary is executable');

      return true;
    } catch (error) {
      this.logger.warn(`Rust binary not available: ${getErrorMessage(error)}`);
      return false;
    }
  }
  async convertExcelToCsv(excelPath: string, outputDir: string): Promise<void> {
    this.logger.log(`Converting Excel to CSV: ${excelPath} -> ${outputDir}`);
    await this.convertExcel(excelPath, outputDir, 'csv');
  }
  async convertExcelToParquet(
    excelPath: string,
    outputDir: string
  ): Promise<void> {
    this.logger.log(
      `Converting Excel to Parquet: ${excelPath} -> ${outputDir}`
    );
    await this.convertExcel(excelPath, outputDir, 'parquet');
  }
  private async convertExcel(
    excelPath: string,
    outputDir: string,
    format: 'csv' | 'parquet'
  ): Promise<void> {
    const isAvailable = await this.isRustToolAvailable();
    if (!isAvailable) {
      throw new Error(
        'Rust tool binary not found. Please ensure the dataset-handling binary is built and available at the expected location.'
      );
    }

    return this.runWithDatasetHandlingSlot(
      () =>
        new Promise((resolve, reject) => {
      require('fs').mkdirSync(outputDir, { recursive: true });

      const rustProcess = spawn(
        this.rustBinaryPath,
        ['convert', '-i', excelPath, '-o', outputDir, '--format', format],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        rustProcess.kill('SIGTERM');
        reject(new Error('Rust tool execution timed out after 20 minutes'));
      }, 20 * 60 * 1000);

      rustProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      rustProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      rustProcess.on('close', (code) => {
        clearTimeout(timeoutHandle);
        if (timedOut) {
          return;
        }

        if (code === 0) {
          this.logger.log(
            `Excel to ${format.toUpperCase()} conversion completed successfully`
          );
          resolve();
        } else {
          this.logger.error(
            `Rust tool failed with code ${code}. Stdout: ${stdout}. Stderr: ${stderr}`
          );
          reject(new Error(`Rust tool failed with code: ${code}`));
        }
      });

      rustProcess.on('error', (error) => {
        clearTimeout(timeoutHandle);
        if (timedOut) {
          return;
        }

        this.logger.error(`Failed to spawn Rust process: ${error.message}`);
        reject(new Error(`Failed to spawn Rust process: ${error.message}`));
      });
    })
    );
  }
  async runRustAnalyzer(dataPath: string): Promise<RustCsvAnalysis> {
    const isAvailable = await this.isRustToolAvailable();
    if (!isAvailable) {
      throw new Error(
        'Rust tool binary not found. Please ensure the dataset-handling binary is built and available at the expected location.'
      );
    }
    const fs = require('fs');
    const fileSizeBytes = fs.statSync(dataPath).size;
    const fileSizeMB = fileSizeBytes / (1024 * 1024);
    const isLargeFile = fileSizeMB > 50;
    const chunkSize = isLargeFile ? 20000 : 10000;
    const enableParallel = fileSizeMB > 10;

    this.logger.log(
      `Analyzing tabular file: ${fileSizeMB.toFixed(
        1
      )}MB, parallel=${enableParallel}, chunks=${chunkSize}`
    );

    return this.runWithDatasetHandlingSlot(
      () =>
        new Promise((resolve, reject) => {
      const args = [
        'analyze',
        '-i',
        dataPath,
        '--chunk-size',
        chunkSize.toString(),
        '--silent',
      ];
      if (enableParallel) {
        args.push('--parallel');
      }

      const process = spawn(this.rustBinaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      process.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr?.on('data', (data) => {
        const stderrText = data.toString();
        if (
          stderrText.includes('') ||
          stderrText.includes('') ||
          stderrText.includes('')
        ) {
          this.logger.verbose(`Rust progress: ${stderrText.trim()}`);
        }
        stderr += stderrText;
      });

      process.on('close', (code) => {
        if (code === 0) {
          try {
            const analysis = JSON.parse(stdout) as RustCsvAnalysis;
            this.logger.debug(
              `Rust analysis successful: ${analysis.columns.length} columns, ${analysis.total_rows} rows`
            );
            resolve(analysis);
          } catch (parseError) {
            const parseErrorMessage = getErrorMessage(parseError);
            this.logger.error(
              `Failed to parse Rust analyzer output: ${parseErrorMessage}`
            );
            this.logger.verbose(`Raw stdout: ${stdout}`);
            reject(
              new Error(
                `Failed to parse Rust analyzer output: ${parseErrorMessage}`
              )
            );
          }
        } else {
          this.logger.error(
            `Rust analyzer failed with code ${code}: ${stderr}`
          );
          reject(new Error(`Rust analyzer failed with code: ${code}`));
        }
      });

      process.on('error', (error) => {
        this.logger.error(`Failed to spawn Rust analyzer: ${error.message}`);
        reject(new Error(`Failed to spawn Rust analyzer: ${error.message}`));
      });

      // Extended timeout for large files (up to 5 minutes)
      const timeoutMs = Math.max(120000, fileSizeMB * 2000); // 2 seconds per MB, minimum 2 minutes
      const timeoutHandle = setTimeout(() => {
        this.logger.warn(
          `Rust analyzer timeout after ${timeoutMs}ms for ${fileSizeMB.toFixed(
            1
          )}MB file`
        );
        process.kill('SIGTERM');
        reject(new Error(`Rust analyzer timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      process.on('close', () => clearTimeout(timeoutHandle));
    })
    );
  }
  async importParquetFilesToPostgres(
    parquetPaths: string[],
    schemaName: string,
    tableName: string,
    columnTypeOverrides: Record<string, string>
  ): Promise<number> {
    const isAvailable = await this.isRustToolAvailable();
    if (!isAvailable) {
      throw new Error(
        'Rust tool binary not found. Please ensure the dataset-handling binary is built and available at the expected location.'
      );
    }

    const databaseUrl = getRustPostgresDatabaseUrl();

    this.logger.log(
      `Streaming ${parquetPaths.length} Parquet file(s) into ${schemaName}.${tableName}`
    );

    const args = [
      'import-parquet',
      '--schema',
      schemaName,
      '--table',
      tableName,
      '--column-type-overrides',
      JSON.stringify(columnTypeOverrides),
      '--truncate',
      '--silent',
      '--inputs',
      ...parquetPaths,
    ];

    return this.runWithDatasetHandlingSlot(
      () =>
        new Promise((resolve, reject) => {
      const rustProcess = spawn(this.rustBinaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
        },
      });

      let stdout = '';
      let stderr = '';
      const timeoutMs = Number(
        process.env.DATA_IMPORT_PARQUET_COPY_TIMEOUT_MS ?? 3_900_000
      );
      let timedOut = false;
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        rustProcess.kill('SIGTERM');
        reject(new Error(`Parquet import timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      rustProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      rustProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      rustProcess.on('close', (code) => {
        clearTimeout(timeoutHandle);
        if (timedOut) {
          return;
        }

        if (code !== 0) {
          this.logger.error(
            `Parquet import failed with code ${code}. Stderr: ${stderr}`
          );
          reject(new Error(`Parquet import failed with code: ${code}`));
          return;
        }

        try {
          const outputLine = stdout.trim().split('\n').filter(Boolean).pop();
          const result = JSON.parse(outputLine ?? '{}') as {
            records?: number;
          };
          resolve(result.records ?? 0);
        } catch (error) {
          const errorMessage = getErrorMessage(error);
          this.logger.error(
            `Failed to parse Parquet import output: ${errorMessage}`
          );
          this.logger.verbose(`Raw stdout: ${stdout}`);
          reject(
            new Error(`Failed to parse Parquet import output: ${errorMessage}`)
          );
        }
      });

      rustProcess.on('error', (error) => {
        clearTimeout(timeoutHandle);
        if (timedOut) {
          return;
        }

        this.logger.error(
          `Failed to spawn Rust Parquet importer: ${error.message}`
        );
        reject(
          new Error(`Failed to spawn Rust Parquet importer: ${error.message}`)
        );
      });
    })
    );
  }
}
