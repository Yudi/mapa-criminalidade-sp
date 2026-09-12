import {
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { constants as fsConstants, promises as fs } from 'fs';
import * as path from 'path';
import Redis from 'ioredis';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from './prisma/prisma.service';
import { RedisCacheService } from './shared/cache/redis-cache.service';

export type HealthResponse = {
  status: 'ok' | 'degraded';
  timestamp: string;
  checks?: Record<string, 'ok' | 'degraded'>;
};

@Injectable()
export class AppService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly cache?: RedisCacheService
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  getLiveness(): HealthResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness(): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw(Prisma.sql`SELECT 1`);
    } catch {
      throw new ServiceUnavailableException('Database is not ready');
    }

    const checks: Record<string, 'ok' | 'degraded'> = {
      database: 'ok',
    };

    if (this.runtimeDependencyChecksEnabled()) {
      checks.storage = (await this.checkStorage()) ? 'ok' : 'degraded';
      checks.queue = (await this.checkRedis(process.env.REDIS_URL))
        ? 'ok'
        : 'degraded';

      if (this.cache) {
        const cacheHealth = await this.cache.getHealth();
        checks.cache =
          cacheHealth.status === 'ready' || cacheHealth.status === 'disabled'
            ? 'ok'
            : 'degraded';
      }

      checks.rust = (await this.checkExecutable(
        process.env.RUST_BINARY_PATH ??
          path.resolve(
            process.cwd(),
            'dataset-handling',
            'target',
            'release',
            'dataset-handling'
          )
      ))
        ? 'ok'
        : 'degraded';
      checks.python = (await this.checkExecutable(
        process.env.PYTHON_BINARY_PATH ?? 'python3'
      ))
        ? 'ok'
        : 'degraded';
    }

    const requiredRuntimeChecks = ['storage', 'queue', 'rust', 'python'];
    const failedRequiredCheck = requiredRuntimeChecks.find(
      (check) => checks[check] === 'degraded'
    );
    if (failedRequiredCheck) {
      throw new ServiceUnavailableException({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        checks,
      });
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  private runtimeDependencyChecksEnabled(): boolean {
    return (
      process.env.NODE_ENV === 'production' ||
      process.env.READINESS_CHECK_RUNTIME_DEPS === 'true'
    );
  }

  private async checkStorage(): Promise<boolean> {
    const candidates = [
      process.env.IMPORT_TEMP_DIR,
      path.resolve(process.cwd(), 'temp'),
      path.resolve(process.cwd(), 'apps', 'backend', 'temp'),
    ].filter((candidate): candidate is string => Boolean(candidate));

    for (const candidate of candidates) {
      try {
        await fs.access(candidate, fsConstants.W_OK);
        const stats = await fs.statfs(candidate);
        const freeBytes = Number(stats.bavail) * Number(stats.bsize);
        return freeBytes >= this.minimumFreeBytes();
      } catch {
        continue;
      }
    }

    return false;
  }

  private minimumFreeBytes(): number {
    const configured = Number(
      process.env.READINESS_MIN_FREE_BYTES ?? 256 * 1024 * 1024
    );
    return Number.isFinite(configured) && configured > 0
      ? configured
      : 256 * 1024 * 1024;
  }

  private async checkRedis(url: string | undefined): Promise<boolean> {
    const redis = new Redis(url ?? 'redis://localhost:6379', {
      connectTimeout: 1_000,
      commandTimeout: 1_000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });

    try {
      await redis.ping();
      return true;
    } catch {
      return false;
    } finally {
      await redis.quit().catch(() => redis.disconnect());
    }
  }

  private async checkExecutable(binaryPath: string): Promise<boolean> {
    const candidates = path.isAbsolute(binaryPath)
      ? [binaryPath]
      : (process.env.PATH ?? '')
          .split(path.delimiter)
          .filter(Boolean)
          .map((directory) => path.join(directory, binaryPath));

    for (const candidate of candidates) {
      try {
        await fs.access(candidate, fsConstants.X_OK);
        return true;
      } catch {
        continue;
      }
    }

    return false;
  }
}
