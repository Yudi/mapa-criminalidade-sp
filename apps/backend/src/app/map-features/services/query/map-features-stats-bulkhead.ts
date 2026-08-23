export class StatsQueryCapacityError extends Error {
  readonly code = 'MAP_FEATURES_STATS_CAPACITY';

  constructor() {
    super('Statistics query capacity is temporarily exhausted');
    this.name = 'StatsQueryCapacityError';
  }
}

type QueueEntry = {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

/** Keeps expensive map statistics from consuming every database connection. */
export class MapFeaturesStatsBulkhead {
  private running = 0;
  private queue: QueueEntry[] = [];

  constructor(
    private readonly maxConcurrent = 2,
    private readonly maxQueued = 64,
    private readonly queueTimeoutMs = 15_000
  ) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async acquire(): Promise<() => void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return () => this.release();
    }

    if (this.queue.length >= this.maxQueued) {
      throw new StatsQueryCapacityError();
    }

    return await new Promise<() => void>((resolve, reject) => {
      const entry: QueueEntry = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.queue = this.queue.filter((queued) => queued !== entry);
          reject(new StatsQueryCapacityError());
        }, this.queueTimeoutMs),
      };
      this.queue.push(entry);
    });
  }

  private release(): void {
    this.running = Math.max(0, this.running - 1);
    const next = this.queue.shift();
    if (!next) return;

    clearTimeout(next.timeout);
    this.running++;
    next.resolve(() => this.release());
  }
}
