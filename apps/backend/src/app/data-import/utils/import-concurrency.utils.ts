import { ImportIoLimiter } from '../types/import-orchestration.types';

export function createImportConcurrencyLimiter(
  concurrencyLimit: number
): ImportIoLimiter {
  let activeCount = 0;
  const queue: Array<() => void> = [];

  const acquire = async (): Promise<() => void> =>
    new Promise((resolve) => {
      const start = () => {
        activeCount++;
        resolve(() => {
          activeCount--;
          const next = queue.shift();
          if (next) {
            next();
          }
        });
      };

      if (activeCount < concurrencyLimit) {
        start();
      } else {
        queue.push(start);
      }
    });

  return async <T>(operation: () => Promise<T>): Promise<T> => {
    const release = await acquire();
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

export async function processWithConcurrency<T, R>(
  items: T[],
  concurrencyLimit: number,
  processor: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrencyLimit, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex++;
        results[currentIndex] = await processor(items[currentIndex]);
      }
    }
  );

  await Promise.all(workers);

  return results;
}
