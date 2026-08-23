import {
  MapFeaturesStatsBulkhead,
  StatsQueryCapacityError,
} from './map-features-stats-bulkhead';

describe('MapFeaturesStatsBulkhead', () => {
  it('serializes expensive statistics scans', async () => {
    const bulkhead = new MapFeaturesStatsBulkhead(1, 4, 1000);
    let running = 0;
    let peak = 0;
    const task = async (): Promise<void> => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
    };

    await Promise.all([bulkhead.run(task), bulkhead.run(task)]);

    expect(peak).toBe(1);
  });

  it('rejects beyond its bounded queue instead of creating unbounded work', async () => {
    const bulkhead = new MapFeaturesStatsBulkhead(1, 0, 1000);
    let release!: () => void;
    const blocker = bulkhead.run(
      () => new Promise<void>((resolve) => (release = resolve))
    );
    await expect(bulkhead.run(async () => undefined)).rejects.toBeInstanceOf(
      StatsQueryCapacityError
    );
    release();
    await blocker;
  });
});
