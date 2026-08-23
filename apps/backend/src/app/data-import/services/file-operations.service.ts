import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { createReadStream, createWriteStream } from 'fs';
import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import type { IncomingMessage } from 'http';
import { randomUUID } from 'crypto';
import { Transform, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import { FileChangeCheck, FileChangeResult } from '../types/data-import.types';

const DEFAULT_ALLOWED_DOWNLOAD_HOSTS = ['www.ssp.sp.gov.br'];
const DEFAULT_ALLOWED_DOWNLOAD_PROTOCOLS = ['https:'];
const DEFAULT_MAX_DOWNLOAD_BYTES = 1_500_000_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MIN_FREE_SPACE_BYTES = 64 * 1024 * 1024;

interface DownloadResult {
  hash?: string;
  size: number;
}

@Injectable()
export class FileOperationsService {
  private readonly logger = new Logger(FileOperationsService.name);
  private readonly defaultDownloadRetries = this.getPositiveIntegerEnv(
    'DATA_IMPORT_DOWNLOAD_RETRIES',
    5,
    1,
    10
  );
  private readonly downloadAttemptTimeoutMs = this.getPositiveIntegerEnv(
    'DATA_IMPORT_DOWNLOAD_ATTEMPT_TIMEOUT_MS',
    600_000,
    30_000,
    1_800_000
  );
  private readonly maxDownloadBytes = this.getPositiveIntegerEnv(
    'DATA_IMPORT_MAX_DOWNLOAD_BYTES',
    DEFAULT_MAX_DOWNLOAD_BYTES,
    1,
    5_000_000_000
  );
  private readonly minFreeSpaceBytes = this.getPositiveIntegerEnv(
    'DATA_IMPORT_MIN_FREE_SPACE_BYTES',
    DEFAULT_MIN_FREE_SPACE_BYTES,
    0,
    5_000_000_000
  );
  private readonly maxRedirects = this.getPositiveIntegerEnv(
    'DATA_IMPORT_MAX_REDIRECTS',
    DEFAULT_MAX_REDIRECTS,
    0,
    20
  );
  private readonly allowedDownloadHosts = this.getStringSetEnv(
    'DATA_IMPORT_ALLOWED_DOWNLOAD_HOSTS',
    DEFAULT_ALLOWED_DOWNLOAD_HOSTS
  );
  private readonly allowedDownloadProtocols = this.getStringSetEnv(
    'DATA_IMPORT_ALLOWED_DOWNLOAD_PROTOCOLS',
    DEFAULT_ALLOWED_DOWNLOAD_PROTOCOLS
  );

  async ensureDirectory(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
    await this.assertFreeSpace(dirPath, 0);
  }

  async downloadFile(
    url: string,
    filePath: string,
    retries = this.defaultDownloadRetries
  ): Promise<void> {
    await this.withDownloadRetries(url, retries, () =>
      this.downloadAttempt(url, filePath, 'file')
    );
    this.logger.log(`Successfully downloaded: ${this.redactUrl(url)}`);
  }

  /**
   * Download once, hash the response while writing it, and publish one final
   * file only after the response has completed and the temporary file is synced.
   * Callers that need a change decision can therefore reuse this payload rather
   * than downloading the same source a second time.
   */
  async downloadFileAndHash(
    url: string,
    filePath: string,
    retries = this.defaultDownloadRetries
  ): Promise<{ hash: string; size: number }> {
    const result = await this.withDownloadRetries(url, retries, () =>
      this.downloadAttempt(url, filePath, 'file-and-hash')
    );
    if (!result.hash) {
      throw new Error('Download completed without a SHA-256 hash');
    }
    this.logger.log(
      `Successfully downloaded and hashed: ${this.redactUrl(url)}`
    );
    return { hash: result.hash, size: result.size };
  }

  async calculateFileHash(filePath: string): Promise<string> {
    return await new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = createReadStream(filePath);
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  async downloadAndHash(
    url: string,
    redirectCount = 0
  ): Promise<{ hash: string; size: number }> {
    // Keep the historical signature for callers that pass a redirect count;
    // retries are handled here so hash-only checks have the same cleanup and
    // deadline guarantees as file downloads.
    if (redirectCount > 0) {
      return await this.downloadAttempt(url, '', 'hash', redirectCount).then(
        (result) => ({ hash: result.hash ?? '', size: result.size })
      );
    }
    const result = await this.withDownloadRetries(url, this.defaultDownloadRetries, () =>
      this.downloadAttempt(url, '', 'hash')
    );
    if (!result.hash) {
      throw new Error('Download completed without a SHA-256 hash');
    }
    return { hash: result.hash, size: result.size };
  }

  private async withDownloadRetries(
    url: string,
    retries: number,
    operation: () => Promise<DownloadResult>
  ): Promise<DownloadResult> {
    const boundedRetries = Math.max(1, Math.min(10, retries));
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= boundedRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = this.toError(error);
        this.logger.warn(
          `Download attempt ${attempt}/${boundedRetries} failed for ${this.redactUrl(
            url
          )}: ${lastError.message}`
        );
        if (!this.isRetryableDownloadError(lastError)) {
          break;
        }
        if (attempt < boundedRetries) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(30_000, 2 ** attempt * 1_000))
          );
        }
      }
    }
    throw new Error(
      `Failed to download ${this.redactUrl(url)} after ${boundedRetries} attempts: ${
        lastError?.message ?? 'unknown error'
      }`
    );
  }

  private async downloadAttempt(
    url: string,
    filePath: string,
    mode: 'file' | 'file-and-hash' | 'hash',
    redirectCount = 0
  ): Promise<DownloadResult> {
    const downloadUrl = this.parseAndValidateDownloadUrl(url);
    const protocol = this.getProtocol(downloadUrl);

    return await new Promise((resolve, reject) => {
      let settled = false;
      let temporaryPath: string | undefined;

      const cleanupTemporary = async (): Promise<void> => {
        if (!temporaryPath) return;
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      };

      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        request.destroy();
        void cleanupTemporary().finally(() => reject(this.toError(error)));
      };

      const complete = (result: DownloadResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        resolve(result);
      };

      const request = protocol.get(downloadUrl, (response: IncomingMessage) => {
        void this.handleDownloadResponse(
          response,
          downloadUrl,
          filePath,
          mode,
          redirectCount,
          (result) => complete(result),
          (error) => fail(error),
          (temporary) => {
            temporaryPath = temporary;
          }
        );
      });

      request.on('error', (error) => fail(error));
      request.setTimeout(this.downloadAttemptTimeoutMs, () => {
        request.destroy();
        fail(new Error('Download inactivity timeout'));
      });
      const timeoutHandle = setTimeout(() => {
        request.destroy();
        fail(
          new Error(
            `Download exceeded total attempt deadline of ${this.downloadAttemptTimeoutMs}ms`
          )
        );
      }, this.downloadAttemptTimeoutMs);
    });
  }

  private async handleDownloadResponse(
    response: IncomingMessage,
    downloadUrl: URL,
    filePath: string,
    mode: 'file' | 'file-and-hash' | 'hash',
    redirectCount: number,
    complete: (result: DownloadResult) => void,
    fail: (error: unknown) => void,
    setTemporaryPath: (temporaryPath: string) => void
  ): Promise<void> {
    const statusCode = response.statusCode ?? 0;
    if (
      statusCode >= 300 &&
      statusCode < 400 &&
      response.headers.location
    ) {
      response.resume();
      if (redirectCount >= this.maxRedirects) {
        fail(new Error(`Exceeded ${this.maxRedirects} download redirects`));
        return;
      }

      try {
        const redirectUrl = this.parseAndValidateDownloadUrl(
          response.headers.location,
          downloadUrl
        );
        const result = await this.downloadAttempt(
          redirectUrl.toString(),
          filePath,
          mode,
          redirectCount + 1
        );
        complete(result);
      } catch (error) {
        fail(error);
      }
      return;
    }

    if (statusCode !== 200) {
      response.resume();
      fail(new Error(`HTTP ${statusCode}: ${response.statusMessage ?? ''}`));
      return;
    }

    const contentLength = this.parseContentLength(response);
    if (contentLength !== undefined && contentLength > this.maxDownloadBytes) {
      response.resume();
      fail(new Error(`Download exceeds ${this.maxDownloadBytes} byte limit`));
      return;
    }

    try {
      if (mode !== 'hash') {
        const parentDirectory = path.dirname(filePath);
        await fs.mkdir(parentDirectory, { recursive: true });
        await this.assertFreeSpace(parentDirectory, contentLength ?? 0);
        const partPath = `${filePath}.${process.pid}.${randomUUID()}.part`;
        setTemporaryPath(partPath);
        await this.streamResponse(response, partPath, contentLength, true);
        await this.syncAndRename(partPath, filePath);
        setTemporaryPath('');
        complete({
          hash: mode === 'file-and-hash' ? await this.calculateFileHash(filePath) : undefined,
          size: await this.getFileSize(filePath),
        });
        return;
      }

      const result = await this.streamResponse(response, '', contentLength, false);
      complete(result);
    } catch (error) {
      fail(error);
    }
  }

  private async streamResponse(
    response: IncomingMessage,
    temporaryPath: string,
    contentLength: number | undefined,
    writeToFile: boolean
  ): Promise<DownloadResult> {
    let totalSize = 0;
    const hash = crypto.createHash('sha256');
    const counter = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        totalSize += chunk.length;
        if (totalSize > this.maxDownloadBytes) {
          callback(
            new Error(`Download exceeds ${this.maxDownloadBytes} byte limit`)
          );
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    const sink = writeToFile
      ? createWriteStream(temporaryPath, { flags: 'wx' })
      : new Writable({ write: (_chunk, _encoding, callback) => callback() });

    response.setTimeout(this.downloadAttemptTimeoutMs, () => {
      response.destroy(new Error('Download response timeout'));
    });
    await pipeline(response, counter, sink);

    if (contentLength !== undefined && totalSize !== contentLength) {
      throw new Error(
        `Download length mismatch: expected ${contentLength} bytes, received ${totalSize}`
      );
    }
    return { hash: hash.digest('hex'), size: totalSize };
  }

  private async syncAndRename(partPath: string, filePath: string): Promise<void> {
    const handle = await fs.open(partPath, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(partPath, filePath);
  }

  private parseContentLength(response: IncomingMessage): number | undefined {
    const rawValue = response.headers['content-length'];
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    if (value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
  }

  private async assertFreeSpace(
    targetPath: string,
    expectedBytes: number
  ): Promise<void> {
    if (typeof fs.statfs !== 'function') return;
    try {
      const stats = await fs.statfs(targetPath);
      const available = Number(stats.bavail) * Number(stats.bsize);
      if (available < expectedBytes + this.minFreeSpaceBytes) {
        throw new Error(
          `Insufficient free space for download: ${available} bytes available, ` +
            `${expectedBytes + this.minFreeSpaceBytes} required`
        );
      }
    } catch (error) {
      if (this.toError(error).message.startsWith('Insufficient free space')) {
        throw error;
      }
      this.logger.warn(`Could not verify free space for ${targetPath}`);
    }
  }

  private parseAndValidateDownloadUrl(url: string, baseUrl?: URL): URL {
    let parsed: URL;
    try {
      parsed = new URL(url, baseUrl);
    } catch {
      throw new Error(`Invalid download URL: ${this.redactUrl(url)}`);
    }

    const protocol = parsed.protocol.toLowerCase();
    if (!this.allowedDownloadProtocols.has(protocol)) {
      throw new Error(`Download protocol is not allowed: ${protocol}`);
    }
    const hostname = parsed.hostname.toLowerCase();
    if (!this.allowedDownloadHosts.has(hostname)) {
      throw new Error(`Download host is not allowed: ${hostname}`);
    }
    return parsed;
  }

  private getProtocol(url: URL): typeof https | typeof http {
    return url.protocol === 'https:' ? https : http;
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

  private getStringSetEnv(name: string, fallback: string[]): Set<string> {
    const rawValue = process.env[name];
    const values =
      rawValue === undefined
        ? fallback
        : rawValue
            .split(',')
            .map((value) => value.trim())
            .filter((value) => value.length > 0);
    return new Set(
      (values.length > 0 ? values : fallback).map((value) => value.toLowerCase())
    );
  }

  private redactUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return '<invalid-url>';
    }
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  private isRetryableDownloadError(error: Error): boolean {
    return !/^(Invalid download URL|Download (host|protocol)|Download exceeds|Download length mismatch|HTTP 4\d\d)/i.test(
      error.message
    );
  }

  async checkMultipleFilesForChanges(
    checks: FileChangeCheck[],
    concurrencyLimit = 5
  ): Promise<FileChangeResult[]> {
    return await this.processInBatches(
      checks,
      async (check) => {
        try {
          const { hash, size } = await this.downloadAndHash(check.url);
          return {
            category: check.category,
            year: check.year,
            hasChanged: !check.existingHash || check.existingHash !== hash,
            newHash: hash,
            size,
          };
        } catch (error) {
          return {
            category: check.category,
            year: check.year,
            hasChanged: false,
            error: this.toError(error).message,
          };
        }
      },
      concurrencyLimit
    );
  }

  private async processInBatches<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    concurrencyLimit: number
  ): Promise<R[]> {
    const results: R[] = [];
    const boundedConcurrency = Math.max(1, Math.min(20, concurrencyLimit));
    for (let i = 0; i < items.length; i += boundedConcurrency) {
      const batch = items.slice(i, i + boundedConcurrency);
      results.push(...(await Promise.all(batch.map((item) => processor(item)))));
    }
    return results;
  }

  async cleanup(filePath?: string, csvDir?: string): Promise<void> {
    const failures: Error[] = [];
    if (filePath && filePath.trim() !== '') {
      try {
        await fs.unlink(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          failures.push(this.toError(error));
        }
      }
    }
    if (csvDir) {
      try {
        await fs.rm(csvDir, { recursive: true, force: true });
      } catch (error) {
        failures.push(this.toError(error));
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `Temporary cleanup failed: ${failures.map((failure) => failure.message).join('; ')}`
      );
    }
  }

  async sweepStaleDirectories(
    rootDir: string,
    maxAgeMs = this.getPositiveIntegerEnv(
      'DATA_IMPORT_TEMP_MAX_AGE_MS',
      24 * 60 * 60 * 1000,
      60_000,
      30 * 24 * 60 * 60 * 1000
    )
  ): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(rootDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    const cutoff = Date.now() - maxAgeMs;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const entryPath = path.join(rootDir, entry.name);
      const stats = await fs.stat(entryPath);
      if (stats.mtimeMs < cutoff) {
        await fs.rm(entryPath, { recursive: true, force: true });
      }
    }
  }

  async getFileSize(filePath: string): Promise<number> {
    return (await fs.stat(filePath)).size;
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
