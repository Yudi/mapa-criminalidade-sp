import { RedisOptions } from 'bullmq';

export function getDataImportQueueConnectionOptions(
  maxRetriesPerRequest: number | null
): RedisOptions {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    return {
      maxRetriesPerRequest,
      enableReadyCheck: false,
      lazyConnect: false,
      url: redisUrl,
    };
  }

  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB ?? 0),
    maxRetriesPerRequest,
    enableReadyCheck: false,
    lazyConnect: false,
  };
}

export function getDataImportWorkerConcurrency(): number {
  const concurrency = Number(process.env.DATA_IMPORT_QUEUE_CONCURRENCY ?? 1);

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    return 1;
  }

  return concurrency;
}
