import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';

const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_REDIS_DB = 0;
const DEFAULT_CONNECT_TIMEOUT_MS = 1_000;
const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly enabled = process.env.CACHE_DISABLED !== 'true';
  private readonly redis = this.enabled ? this.createRedis() : null;
  private connectionPromise: Promise<void> | null = null;
  private hasLoggedUnavailable = false;

  async onModuleInit(): Promise<void> {
    if (!this.redis) return;

    this.redis.on('error', (error) => {
      if (!this.hasLoggedUnavailable) {
        this.logger.warn(`Redis cache unavailable: ${error.message}`);
        this.hasLoggedUnavailable = true;
      }
    });

    await this.ensureReady();
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (!(await this.ensureReady())) return null;

    try {
      const value = await this.redis?.get(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch (error) {
      this.logCommandError('read', key, error);
      return null;
    }
  }

  async setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (!(await this.ensureReady())) return;

    try {
      await this.redis?.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logCommandError('write', key, error);
    }
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    if (!(await this.ensureReady())) return 0;

    const redis = this.redis;
    if (!redis) return 0;

    let cursor = '0';
    let deleted = 0;
    const pattern = `${prefix}*`;

    try {
      do {
        const [nextCursor, keys] = await redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          250
        );
        cursor = nextCursor;

        if (keys.length > 0) {
          deleted += await redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (error) {
      this.logCommandError('delete', pattern, error);
    }

    return deleted;
  }

  private async ensureReady(): Promise<boolean> {
    if (!this.redis) return false;

    if (this.isReady()) {
      this.hasLoggedUnavailable = false;
      return true;
    }

    if (this.connectionPromise) {
      await this.connectionPromise.catch(() => undefined);
      return this.isReady();
    }

    if (this.redis.status !== 'wait' && this.redis.status !== 'end') {
      return false;
    }

    this.connectionPromise = this.redis
      .connect()
      .then(() => undefined)
      .catch((error: Error) => {
        if (!this.hasLoggedUnavailable) {
          this.logger.warn(`Redis cache connection failed: ${error.message}`);
          this.hasLoggedUnavailable = true;
        }
      })
      .finally(() => {
        this.connectionPromise = null;
      });

    await this.connectionPromise;
    return this.isReady();
  }

  private createRedis(): Redis {
    const redisUrl = process.env.REDIS_CACHE_URL ?? process.env.REDIS_URL;
    const commonOptions: RedisOptions = {
      connectTimeout: Number(
        process.env.REDIS_CACHE_CONNECT_TIMEOUT_MS ?? DEFAULT_CONNECT_TIMEOUT_MS
      ),
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) =>
        Math.min(times * RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS),
    };

    if (redisUrl) {
      return new Redis(redisUrl, {
        ...commonOptions,
        db: Number(
          process.env.REDIS_CACHE_DB ?? process.env.REDIS_DB ?? DEFAULT_REDIS_DB
        ),
        password: process.env.REDIS_PASSWORD || undefined,
      });
    }

    return new Redis({
      ...commonOptions,
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? DEFAULT_REDIS_PORT),
      password: process.env.REDIS_PASSWORD || undefined,
      db: Number(
        process.env.REDIS_CACHE_DB ?? process.env.REDIS_DB ?? DEFAULT_REDIS_DB
      ),
    });
  }

  private isReady(): boolean {
    return this.redis?.status === 'ready';
  }

  private logCommandError(
    action: 'read' | 'write' | 'delete',
    key: string,
    error: unknown
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Redis cache ${action} failed for ${key}: ${message}`);
  }
}
