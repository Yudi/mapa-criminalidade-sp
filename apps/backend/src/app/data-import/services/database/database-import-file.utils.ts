import { createReadStream, existsSync, realpathSync } from 'fs';
import * as path from 'path';
import csvParser from 'csv-parser';

export const POSTGRES_SHARED_IMPORT_PATH = '/tmp/shared_import';

export function convertToPostgresSharedPath(
  localPath: string,
  cwd = process.cwd()
): string {
  const tempDir = path.resolve(cwd, 'temp');

  const resolvedPath = path.resolve(localPath);
  const canonicalTempDir = canonicalPath(tempDir);
  const canonicalPathValue = canonicalPath(resolvedPath);
  const relativePath = path.relative(canonicalTempDir, canonicalPathValue);

  if (
    relativePath === '' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return localPath;
  }

  return path.posix.join(
    POSTGRES_SHARED_IMPORT_PATH,
    relativePath.split(path.sep).join(path.posix.sep)
  );
}

export async function readCsvHeaderColumns(
  csvFilePath: string
): Promise<string[]> {
  return await new Promise((resolve, reject) => {
    const fileStream = createReadStream(csvFilePath);
    const parser = csvParser({
      separator: ';',
      headers: false,
      strict: true,
      mapValues: ({ value }) => {
        const trimmed = value.replace(/^\uFEFF/, '').trim();
        return trimmed.startsWith('"') && trimmed.endsWith('"')
          ? trimmed.slice(1, -1).replace(/""/g, '"')
          : trimmed;
      },
    });
    let settled = false;

    const finish = (error?: Error, headers: string[] = []): void => {
      if (settled) return;
      settled = true;
      fileStream.destroy();
      parser.destroy();
      if (error) {
        reject(error);
      } else {
        resolve(headers);
      }
    };

    parser.once('data', (record: Record<string, string>) => {
      const headers = Object.keys(record)
        .sort((left, right) => Number(left) - Number(right))
        .map((key) => record[key] ?? '');
      finish(undefined, headers);
    });
    parser.once('end', () => finish());
    parser.once('error', (error: Error) => finish(error));
    fileStream.once('error', (error) => finish(error));
    fileStream.pipe(parser);
  });
}

export async function countCsvDataRows(csvFilePath: string): Promise<number> {
  return await new Promise((resolve, reject) => {
    const fileStream = createReadStream(csvFilePath);
    const parser = csvParser({
      separator: ';',
      strict: true,
      mapHeaders: ({ header }) => header.replace(/^\uFEFF/, '').trim(),
    });
    let rowCount = 0;
    let settled = false;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      fileStream.destroy();
      parser.destroy();
      if (error) {
        reject(error);
      } else {
        resolve(rowCount);
      }
    };

    parser.on('data', () => {
      rowCount++;
    });
    parser.once('end', () => finish());
    parser.once('error', (error: Error) => finish(error));
    fileStream.once('error', (error) => finish(error));
    fileStream.pipe(parser);
  });
}

function canonicalPath(filePath: string): string {
  if (!existsSync(filePath)) {
    return filePath;
  }

  try {
    return realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
}
