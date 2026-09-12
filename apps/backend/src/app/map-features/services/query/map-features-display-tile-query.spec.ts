import { MapFeaturesVectorTileQuery } from './map-features-vector-tile-query';
import { PrismaService } from '../../../prisma/prisma.service';

describe('Martin display tile fallback', () => {
  it('uses the existing cancellation and concurrency path for density queries', async () => {
    const executeCancelableReadOnlyQuery = jest
      .fn()
      .mockResolvedValue([{ mvt: Buffer.from([1]) }]);
    const query = new MapFeaturesVectorTileQuery({
      executeCancelableReadOnlyQuery,
    } as unknown as PrismaService);
    const controller = new AbortController();
    expect(
      await query.getTile(
        { z: 12, x: 100, y: 200, mode: 'density' },
        controller.signal
      )
    ).toEqual({ status: 'ok', tile: Buffer.from([1]) });
    expect(executeCancelableReadOnlyQuery).toHaveBeenCalledWith(
      expect.stringContaining('public.occurrences'),
      [12, 100, 200, JSON.stringify({ mode: 'density' })],
      controller.signal
    );
  });
});
