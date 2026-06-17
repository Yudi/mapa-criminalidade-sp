import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { createReadStream, createWriteStream } from 'fs';
import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import type { IncomingMessage } from 'http';
import { FileChangeCheck, FileChangeResult } from '../types/data-import.types';

const DEFAULT_ALLOWED_DOWNLOAD_HOSTS = ['www.ssp.sp.gov.br'];
const DEFAULT_ALLOWED_DOWNLOAD_PROTOCOLS = ['https:'];
const DEFAULT_MAX_DOWNLOAD_BYTES = 1_500_000_000;
const DEFAULT_MAX_REDIRECTS = 5;

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
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }
  async downloadFile(
    url: string,
    filePath: string,
    retries = this.defaultDownloadRetries
  ): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.downloadFileAttempt(url, filePath);
        this.logger.log(`Successfully downloaded: ${url}`);
        return;
      } catch (error) {
        const errorMessage = this.getErrorMessage(error);
        this.logger.warn(
          `Download attempt ${attempt}/${retries} failed for ${url}: ${errorMessage}`
        );

        if (attempt === retries) {
          throw new Error(
            `Failed to download ${url} after ${retries} attempts: ${errorMessage}`
          );
        }

        // Wait before retry (exponential backoff)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt) * 1000)
        );
      }
    }
  }

  private async downloadFileAttempt(
    url: string,
    filePath: string,
    redirectCount = 0
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const downloadUrl = this.parseAndValidateDownloadUrl(url);
      const file = createWriteStream(filePath);
      const protocol = this.getProtocol(downloadUrl);
      let totalSize = 0;
      let settled = false;

      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        file.destroy();
        reject(error);
      };

      const request = protocol.get(downloadUrl, (response: IncomingMessage) => {
        const statusCode = response.statusCode ?? 0;
        if (
          statusCode >= 300 &&
          statusCode < 400 &&
          response.headers.location
        ) {
          file.destroy();
          if (redirectCount >= this.maxRedirects) {
            fail(new Error(`Exceeded ${this.maxRedirects} download redirects`));
            return;
          }

          let redirectUrl: URL;
          try {
            redirectUrl = this.parseAndValidateDownloadUrl(
              response.headers.location,
              downloadUrl
            );
          } catch (error) {
            fail(this.toError(error));
            return;
          }

          return this.downloadFileAttempt(
            redirectUrl.toString(),
            filePath,
            redirectCount + 1
          )
            .then(resolve)
            .catch(reject);
        }

        if (statusCode !== 200) {
          file.destroy();
          reject(new Error(`HTTP ${statusCode}: ${response.statusMessage}`));
          return;
        }

        response.on('data', (chunk: Buffer) => {
          totalSize += chunk.length;
          if (totalSize > this.maxDownloadBytes) {
            response.destroy();
            fail(
              new Error(
                `Download exceeds ${this.maxDownloadBytes} byte limit`
              )
            );
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          if (settled) return;
          settled = true;
          file.close();
          resolve();
        });

        file.on('error', (error: Error) => {
          fail(error);
        });
      });

      request.on('error', (error: Error) => {
        fail(error);
      });

      request.setTimeout(this.downloadAttemptTimeoutMs, () => {
        request.destroy();
        fail(new Error('Download timeout'));
      });
    });
  }
  async calculateFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
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
    return new Promise((resolve, reject) => {
      const downloadUrl = this.parseAndValidateDownloadUrl(url);
      const hash = crypto.createHash('sha256');
      const protocol = this.getProtocol(downloadUrl);
      let totalSize = 0;
      let settled = false;

      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      const request = protocol.get(downloadUrl, (response: IncomingMessage) => {
        const statusCode = response.statusCode ?? 0;
        if (
          statusCode >= 300 &&
          statusCode < 400 &&
          response.headers.location
        ) {
          if (redirectCount >= this.maxRedirects) {
            fail(new Error(`Exceeded ${this.maxRedirects} download redirects`));
            return;
          }

          let redirectUrl: URL;
          try {
            redirectUrl = this.parseAndValidateDownloadUrl(
              response.headers.location,
              downloadUrl
            );
          } catch (error) {
            fail(this.toError(error));
            return;
          }

          return this.downloadAndHash(redirectUrl.toString(), redirectCount + 1)
            .then(resolve)
            .catch(reject);
        }

        if (statusCode !== 200) {
          reject(new Error(`HTTP ${statusCode}: ${response.statusMessage}`));
          return;
        }

        response.on('data', (chunk: Buffer) => {
          totalSize += chunk.length;
          if (totalSize > this.maxDownloadBytes) {
            response.destroy();
            fail(
              new Error(
                `Download exceeds ${this.maxDownloadBytes} byte limit`
              )
            );
            return;
          }

          hash.update(chunk);
        });

        response.on('end', () => {
          if (settled) return;
          settled = true;
          resolve({
            hash: hash.digest('hex'),
            size: totalSize,
          });
        });

        response.on('error', fail);
      });

      request.on('error', fail);
      request.setTimeout(this.downloadAttemptTimeoutMs, () => {
        request.destroy();
        fail(new Error('Download timeout'));
      });
    });
  }

  private parseAndValidateDownloadUrl(
    url: string,
    baseUrl?: URL
  ): URL {
    let parsed: URL;
    try {
      parsed = new URL(url, baseUrl);
    } catch {
      throw new Error(`Invalid download URL: ${url}`);
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

    if (!Number.isInteger(value) || value < min) {
      return fallback;
    }

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
      (values.length > 0 ? values : fallback).map((value) =>
        value.toLowerCase()
      )
    );
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
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
          const hasChanged = !check.existingHash || check.existingHash !== hash;

          return {
            category: check.category,
            year: check.year,
            hasChanged,
            newHash: hash,
            size,
          };
        } catch (error) {
          return {
            category: check.category,
            year: check.year,
            hasChanged: false,
            error: this.getErrorMessage(error),
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

    for (let i = 0; i < items.length; i += concurrencyLimit) {
      const batch = items.slice(i, i + concurrencyLimit);
      const batchPromises = batch.map((item) => processor(item));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }
  async cleanup(filePath?: string, csvDir?: string): Promise<void> {
    try {
      if (filePath && filePath.trim() !== '') {
        await fs.unlink(filePath);
      }
      if (csvDir) {
        await fs.rm(csvDir, { recursive: true, force: true });
      }
    } catch (error) {
      this.logger.warn(`Failed to cleanup temporary files:`, error);
    }
  }
  async getFileSize(filePath: string): Promise<number> {
    const stats = await fs.stat(filePath);
    return stats.size;
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
