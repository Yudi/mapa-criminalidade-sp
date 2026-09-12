import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { Client, Pool, PoolClient, Query, QueryResultRow } from 'pg';
import { getDatabaseUrl } from './database-url.util';
import { MAP_FEATURES_TILE_CONFIG } from '../map-features/services/query/map-features-tile-query';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly tilePool: Pool;

  constructor() {
    const tilePool = new Pool({
      connectionString: getDatabaseUrl(),
      max: PrismaService.getPositiveIntegerEnv('PRISMA_POOL_MAX', 3),
      idleTimeoutMillis: PrismaService.getPositiveIntegerEnv(
        'PRISMA_POOL_IDLE_TIMEOUT_MS',
        10_000
      ),
      connectionTimeoutMillis: PrismaService.getPositiveIntegerEnv(
        'PRISMA_POOL_CONNECTION_TIMEOUT_MS',
        5_000
      ),
    });

    super({
      adapter: new PrismaPg(tilePool, { disposeExternalPool: true }),
    });
    this.tilePool = tilePool;
  }

  /** Executes one read-only tile query and cancels it on client disconnect. */
  async executeCancelableReadOnlyQuery<
    T extends QueryResultRow = Record<string, unknown>
  >(
    queryText: string,
    params: readonly unknown[],
    signal?: AbortSignal
  ): Promise<T[]> {
    if (signal?.aborted) throw createAbortError();

    const client = await this.tilePool.connect();
    let activeQuery: Query<T> | null = null;
    let releaseError: Error | undefined;
    let cancelClient: Client | undefined;
    const cancelQuery = () => {
      if (!activeQuery) return;
      cancelClient = new Client({ connectionString: getDatabaseUrl() });
      cancelClient.on('error', () => {
        /* The statement deadline remains the fallback. */
      });
      const cancellableClient = cancelClient as Client & {
        cancel: (client: PoolClient, query: Query<T>) => void;
      };
      cancellableClient.cancel(client, activeQuery);
    };
    signal?.addEventListener('abort', cancelQuery, { once: true });

    try {
      if (signal?.aborted) throw createAbortError();
      await client.query('BEGIN');
      await client.query('SET TRANSACTION READ ONLY');
      await client.query(
        `SET LOCAL statement_timeout = '${MAP_FEATURES_TILE_CONFIG.STATEMENT_TIMEOUT_MS}ms'`
      );
      await client.query("SET LOCAL lock_timeout = '5000ms'");
      await client.query('SET LOCAL plan_cache_mode = force_custom_plan');
      await client.query("SET LOCAL work_mem = '32MB'");

      if (signal?.aborted) throw createAbortError();

      const rows = await new Promise<T[]>((resolve, reject) => {
        activeQuery = new Query<T>(
          {
            text: queryText,
            values: [...params],
          },
          (error, result) => {
            activeQuery = null;
            if (error) {
              reject(error);
              return;
            }
            resolve(result.rows);
          }
        );
        client.query(activeQuery);
      });

      if (signal?.aborted) throw createAbortError();
      await client.query('COMMIT');
      return rows;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        releaseError =
          rollbackError instanceof Error
            ? rollbackError
            : new Error(String(rollbackError));
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancelQuery);
      void cancelClient?.end().catch(() => undefined);
      client.release(releaseError);
    }
  }

  async executeReadOnlyStatsQuery<T>(
    queryText: string,
    ...params: unknown[]
  ): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '15000ms'");
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3000ms'");
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return tx.$queryRawUnsafe<T>(queryText, ...params);
      },
      { maxWait: 5_000, timeout: 20_000 }
    );
  }

  private static getPositiveIntegerEnv(name: string, fallback: number): number {
    const value = Number(process.env[name] ?? fallback);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

function createAbortError(): Error {
  const error = new Error('Tile query cancelled');
  error.name = 'AbortError';
  return error;
}
