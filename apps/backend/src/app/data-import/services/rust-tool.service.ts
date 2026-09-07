import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ChildProcess, spawn } from 'child_process';
import { constants, promises as fs } from 'fs';
import * as path from 'path';
import { RustCsvAnalysis } from '../types/data-import.types';
import { getRustPostgresDatabaseUrl } from '../../prisma/database-url.util';
import { getErrorMessage } from '../../shared/error.utils';

const DATASET_HANDLING_PARALLELIZATION = 1;
const DEFAULT_COMMAND_TIMEOUT_MS = 20 * 60 * 1000;
const PROCESS_TERMINATION_GRACE_MS = 5_000;
const DEFAULT_OUTPUT_LIMIT = 1_048_576;

interface ProcessResult {
  stdout: string;
  stderr: string;
}

class BoundedOutput {
  private value = '';
  private truncated = false;

  constructor(private readonly limit: number) {}

  append(chunk: Buffer | string): void {
    if (this.truncated) return;
    const text = chunk.toString();
    const remaining = this.limit - this.value.length;
    if (text.length <= remaining) {
      this.value += text;
      return;
    }

    this.value += text.slice(0, Math.max(0, remaining));
    this.value += '\n[… output truncated …]';
    this.truncated = true;
  }

  toString(): string {
    return this.value;
  }
}

@Injectable()
export class RustToolService implements OnModuleDestroy {
  private readonly logger = new Logger(RustToolService.name);
  private activeDatasetHandlingProcesses = 0;
  private readonly datasetHandlingQueue: Array<{
    start: () => void;
    reject: (error: Error) => void;
  }> = [];
  private readonly activeChildren = new Set<ChildProcess>();
  private isShuttingDown = false;
  private readonly rustToolPath = path.resolve(
    __dirname,
    '../../../dataset-handling'
  );
  private readonly outputLimit = this.getPositiveIntegerEnv(
    'DATA_IMPORT_SUBPROCESS_OUTPUT_LIMIT_BYTES',
    DEFAULT_OUTPUT_LIMIT,
    1024,
    16 * 1024 * 1024
  );

  private get rustBinaryPath(): string {
    const envBinaryPath = process.env.RUST_BINARY_PATH?.trim();
    if (envBinaryPath) {
      return path.resolve(envBinaryPath);
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

  getRustBinaryPath(): string {
    return this.rustBinaryPath;
  }

  async runWithDatasetHandlingSlot<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquireDatasetHandlingSlot();

    try {
      if (this.isShuttingDown) {
        throw new Error('Rust tool is shutting down');
      }
      return await operation();
    } finally {
      release();
    }
  }

  private acquireDatasetHandlingSlot(): Promise<() => void> {
    return new Promise((resolve, reject) => {
      if (this.isShuttingDown) {
        reject(new Error('Rust tool is shutting down'));
        return;
      }

      const start = () => {
        if (this.isShuttingDown) {
          reject(new Error('Rust tool is shutting down'));
          return;
        }
        this.activeDatasetHandlingProcesses++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.activeDatasetHandlingProcesses--;
          const next = this.datasetHandlingQueue.shift();
          if (next) next.start();
        });
      };

      if (
        this.activeDatasetHandlingProcesses < DATASET_HANDLING_PARALLELIZATION
      ) {
        start();
      } else {
        this.datasetHandlingQueue.push({ start, reject });
      }
    });
  }

  async ensureRustTool(): Promise<void> {
    try {
      await fs.access(this.rustBinaryPath, constants.X_OK);
      this.logger.log(`Rust tool found at: ${this.rustBinaryPath}`);
    } catch {
      throw new Error(
        `Rust tool binary not found or not executable at: ${this.rustBinaryPath}. ` +
          'The binary must be built before the application starts.'
      );
    }
  }

  async isRustToolAvailable(): Promise<boolean> {
    try {
      await fs.access(this.rustBinaryPath, constants.X_OK);
      return true;
    } catch (error) {
      this.logger.warn(`Rust binary not available: ${getErrorMessage(error)}`);
      return false;
    }
  }

  async runDatasetHandlingCommand(
    args: string[],
    timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
    environment: NodeJS.ProcessEnv = process.env
  ): Promise<ProcessResult> {
    await this.ensureRustTool();
    return this.runWithDatasetHandlingSlot(() =>
      this.executeCommand(this.rustBinaryPath, args, timeoutMs, environment)
    );
  }

  async convertExcelToCsv(excelPath: string, outputDir: string): Promise<void> {
    this.logger.log(`Converting Excel to CSV: ${excelPath} -> ${outputDir}`);
    await this.runDatasetHandlingCommand([
      'convert',
      '-i',
      excelPath,
      '-o',
      outputDir,
      '--format',
      'csv',
    ]);
  }

  async convertExcelToParquet(
    excelPath: string,
    outputDir: string
  ): Promise<void> {
    this.logger.log(
      `Converting Excel to Parquet: ${excelPath} -> ${outputDir}`
    );
    await this.runDatasetHandlingCommand([
      'convert',
      '-i',
      excelPath,
      '-o',
      outputDir,
      '--format',
      'parquet',
    ]);
  }

  async runRustAnalyzer(dataPath: string): Promise<RustCsvAnalysis> {
    if (!(await this.isRustToolAvailable())) {
      throw new Error(
        `Rust tool binary not found at ${this.rustBinaryPath}.`
      );
    }

    const stats = await fs.stat(dataPath);
    const fileSizeMB = stats.size / (1024 * 1024);
    const chunkSize = fileSizeMB > 50 ? 20_000 : 10_000;
    const args = [
      'analyze',
      '-i',
      dataPath,
      '--chunk-size',
      chunkSize.toString(),
      '--silent',
    ];
    if (fileSizeMB > 10) args.push('--parallel');

    const timeoutMs = Math.max(120_000, fileSizeMB * 2_000);
    const result = await this.runDatasetHandlingCommand(args, timeoutMs);

    try {
      const analysis = JSON.parse(result.stdout) as RustCsvAnalysis;
      if (
        !Array.isArray(analysis.columns) ||
        !Number.isInteger(analysis.total_rows)
      ) {
        throw new Error('Analyzer response has an invalid shape');
      }
      return analysis;
    } catch (error) {
      throw new Error(
        `Failed to parse Rust analyzer output: ${getErrorMessage(error)}`
      );
    }
  }

  async importParquetFilesToPostgres(
    parquetPaths: string[],
    schemaName: string,
    tableName: string,
    columnTypeOverrides: Record<string, string>
  ): Promise<number> {
    const databaseUrl = getRustPostgresDatabaseUrl();
    const timeoutMs = Number(
      process.env.DATA_IMPORT_PARQUET_COPY_TIMEOUT_MS ?? 3_900_000
    );
    const result = await this.runDatasetHandlingCommand(
      [
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
      ],
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 3_900_000,
      { ...process.env, DATABASE_URL: databaseUrl }
    );

    try {
      const outputLine = result.stdout.trim().split('\n').filter(Boolean).pop();
      const parsed = JSON.parse(outputLine ?? '{}') as { records?: unknown };
      if (!Number.isInteger(parsed.records) || (parsed.records as number) < 0) {
        throw new Error('Parquet import response did not include a record count');
      }
      return parsed.records as number;
    } catch (error) {
      throw new Error(
        `Failed to parse Parquet import output: ${getErrorMessage(error)}`
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;
    const shutdownError = new Error('Rust tool is shutting down');
    const queued = this.datasetHandlingQueue.splice(0);
    for (const waiter of queued) {
      waiter.reject(shutdownError);
    }

    const children = Array.from(this.activeChildren);
    await Promise.all(
      children.map((child) => this.terminateChild(child, undefined, true))
    );
  }

  private async executeCommand(
    binaryPath: string,
    args: string[],
    timeoutMs: number,
    environment: NodeJS.ProcessEnv
  ): Promise<ProcessResult> {
    return await new Promise((resolve, reject) => {
      const child = spawn(binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: environment,
        detached: true,
      });
      this.activeChildren.add(child);
      const stdout = new BoundedOutput(this.outputLimit);
      const stderr = new BoundedOutput(this.outputLimit);
      let settled = false;
      let timeoutRequested = false;
      let closeResolve: () => void = () => undefined;
      const closed = new Promise<void>((resolveClosed) => {
        closeResolve = resolveClosed;
      });

      const finish = (error?: Error, result?: ProcessResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        this.activeChildren.delete(child);
        if (error) reject(error);
        else {
          resolve(
            result ?? {
              stdout: stdout.toString(),
              stderr: stderr.toString(),
            }
          );
        }
      };

      const timeoutHandle = setTimeout(() => {
        timeoutRequested = true;
        void (async () => {
          const terminated = await this.terminateChild(child, closed);
          if (!terminated) {
            finish(
              new Error(
                `Rust tool did not terminate after ${timeoutMs}ms timeout`
              )
            );
            return;
          }
          finish(new Error(`Rust tool execution timed out after ${timeoutMs}ms`));
        })();
      }, timeoutMs);

      child.stdout?.on('data', (data: Buffer) => stdout.append(data));
      child.stderr?.on('data', (data: Buffer) => stderr.append(data));
      child.once('error', (error) => {
        closeResolve();
        if (timeoutRequested) return;
        finish(new Error(`Failed to spawn Rust process: ${error.message}`));
      });
      child.once('close', (code, signal) => {
        closeResolve();
        if (timeoutRequested) return;
        if (code === 0) {
          finish(undefined, {
            stdout: stdout.toString(),
            stderr: stderr.toString(),
          });
        } else {
          const suffix = signal ? ` (signal ${signal})` : '';
          finish(
            new Error(
              `Rust tool failed with code ${code ?? 'unknown'}${suffix}. ` +
                `Stderr: ${stderr.toString()}`
            )
          );
        }
      });
    });
  }

  private async terminateChild(
    child: ChildProcess,
    closedPromise?: Promise<void>,
    forceImmediately = false
  ): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    const closed =
      closedPromise ?? new Promise<void>((resolve) => child.once('close', resolve));
    this.signalProcessGroup(child, forceImmediately ? 'SIGKILL' : 'SIGTERM');

    if (
      await this.waitForClose(
        closed,
        forceImmediately ? 1_000 : PROCESS_TERMINATION_GRACE_MS
      )
    ) {
      return true;
    }

    this.signalProcessGroup(child, 'SIGKILL');
    return await this.waitForClose(closed, PROCESS_TERMINATION_GRACE_MS);
  }

  private signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
    if (child.pid && process.platform !== 'win32') {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        // Fall back to the direct child when a process group is unavailable.
      }
    }
    try {
      child.kill(signal);
    } catch {
      // The child may have exited between the state check and the signal.
    }
  }

  private async waitForClose(
    closed: Promise<void>,
    timeoutMs: number
  ): Promise<boolean> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(false), timeoutMs);
    });
    const result = await Promise.race([closed.then(() => true), timeout]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return result;
  }

  private getPositiveIntegerEnv(
    name: string,
    fallback: number,
    min: number,
    max: number
  ): number {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isInteger(value) || value < min) return fallback;
    return Math.min(value, max);
  }
}
