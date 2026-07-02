import { Prisma } from '../../../../generated/prisma/client';

export type SqlParam = string | number;

export type RawTileBuffer = Buffer | Uint8Array | ArrayBuffer | number[];

export type TileQueryRow = { mvt: RawTileBuffer | null };

export type MapFeatureTileResult =
  | { status: 'ok'; tile: Buffer }
  | { status: 'empty'; tile: null }
  | { status: 'timeout'; tile: null };

type SemaphoreQueueEntry = {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
};

export const MAP_FEATURES_TILE_CONFIG = {
  MAX_CONCURRENT_TILES: getPositiveIntegerEnv(
    'MAP_FEATURES_MAX_CONCURRENT_TILES',
    2,
    1,
    16
  ),
  MAX_QUEUED_TILES: getPositiveIntegerEnv(
    'MAP_FEATURES_MAX_QUEUED_TILES',
    512,
    0,
    10_000
  ),
  QUEUE_TIMEOUT_MS: getPositiveIntegerEnv(
    'MAP_FEATURES_TILE_QUEUE_TIMEOUT_MS',
    30_000,
    1_000,
    120_000
  ),
  STATEMENT_TIMEOUT_MS: getPositiveIntegerEnv(
    'MAP_FEATURES_TILE_STATEMENT_TIMEOUT_MS',
    30_000,
    5_000,
    120_000
  ),
  TRANSACTION_MAX_WAIT_MS: getPositiveIntegerEnv(
    'MAP_FEATURES_TILE_TRANSACTION_MAX_WAIT_MS',
    30_000,
    1_000,
    120_000
  ),
} as const;

export function normalizeTileBuffer(value: RawTileBuffer): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }

  return Buffer.from(value);
}

export async function configureTileTransaction(
  tx: Prisma.TransactionClient
): Promise<void> {
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  await tx.$executeRawUnsafe(
    `SET LOCAL statement_timeout = '${MAP_FEATURES_TILE_CONFIG.STATEMENT_TIMEOUT_MS}ms'`
  );
  await tx.$executeRawUnsafe('SET LOCAL plan_cache_mode = force_custom_plan');
  await tx.$executeRawUnsafe("SET LOCAL work_mem = '32MB'");
}

export class Semaphore {
  private running = 0;
  private queue: SemaphoreQueueEntry[] = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueued: number,
    private readonly queueTimeoutMs: number
  ) {}

  async acquire(): Promise<() => void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return () => this.release();
    }

    if (this.queue.length >= this.maxQueued) {
      throw new Error('Tile queue is full');
    }

    return new Promise<() => void>((resolve, reject) => {
      const entry: SemaphoreQueueEntry = {
        resolve,
        reject,
        timeoutHandle: setTimeout(() => {
          this.queue = this.queue.filter((item) => item !== entry);
          reject(new Error('Tile queue wait timed out'));
        }, this.queueTimeoutMs),
      };
      this.queue.push(entry);
    });
  }

  release(): void {
    this.running = Math.max(0, this.running - 1);
    const next = this.queue.shift();
    if (next) {
      clearTimeout(next.timeoutHandle);
      this.running++;
      next.resolve(() => this.release());
    }
  }
}

function getPositiveIntegerEnv(
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
