import { createReadStream } from 'fs';
import * as path from 'path';
import { createInterface } from 'readline';

export const POSTGRES_SHARED_IMPORT_PATH = '/tmp/shared_import';

export function convertToPostgresSharedPath(
  localPath: string,
  cwd = process.cwd()
): string {
  const tempDir = path.resolve(cwd, 'temp');

  if (!localPath.startsWith(tempDir)) {
    return localPath;
  }

  const relativePath = path.relative(tempDir, localPath);
  return path.posix.join(POSTGRES_SHARED_IMPORT_PATH, relativePath);
}

export async function readCsvHeaderColumns(csvFilePath: string): Promise<string[]> {
  const fileStream = createReadStream(csvFilePath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl as AsyncIterable<string>) {
      return line.split(';').map((col) => col.trim().replace(/"/g, ''));
    }
  } finally {
    rl.close();
  }

  return [];
}
