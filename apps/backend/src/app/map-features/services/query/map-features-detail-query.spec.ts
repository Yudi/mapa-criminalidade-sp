import { PrismaService } from '../../../prisma/prisma.service';
import {
  AmbiguousMapFeatureLookupError,
  MAX_DETAIL_RESULTS,
  MapFeaturesDetailQuery,
} from './map-features-detail-query';

describe('MapFeaturesDetailQuery', () => {
  it('caps summary/detail list hydration and keeps deterministic ordering', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      mapFeature: { findMany },
    } as unknown as PrismaService;
    const sourceHydrator = { hydrate: jest.fn() };
    const query = new MapFeaturesDetailQuery(
      prisma,
      sourceHydrator as never
    );

    await expect(query.getFeaturesByBo('123')).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: MAX_DETAIL_RESULTS,
        orderBy: [{ data_ocorrencia: 'desc' }, { id: 'asc' }],
      })
    );
  });

  it('does not silently pick the newest row for an ambiguous singular lookup', async () => {
    const findMany = jest.fn().mockResolvedValue([{}, {}]);
    const prisma = {
      mapFeature: { findMany },
    } as unknown as PrismaService;
    const query = new MapFeaturesDetailQuery(
      prisma,
      { hydrate: jest.fn() } as never
    );

    await expect(query.getFeatureByBo('123')).rejects.toBeInstanceOf(
      AmbiguousMapFeatureLookupError
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2 })
    );
  });
});
