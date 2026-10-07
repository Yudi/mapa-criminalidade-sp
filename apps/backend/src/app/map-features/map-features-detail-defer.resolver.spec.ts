import { MapFeaturesResolver } from './map-features.resolver';
import { MapFeaturesQueryService } from './services/map-features-query.service';
import { MapFeaturesMapperService } from './services/map-features-mapper.service';
import { ValidatorsService } from '../shared/validators/validators.service';
import type { MapFeature } from './types/map-features.types';
import { MapFeatureDetailObject } from './graphql/map-features.graphql';

it('loads IML data only when its fields are selected and shares the enrichment', async () => {
  const feature = { id: '018f0000-0000-7000-8000-000000000001' } as MapFeature;
  const detail = { featureData: { records: [] }, imlRecords: [] } as unknown as MapFeatureDetailObject;
  const queryService = {
    getFeatureById: jest.fn().mockResolvedValue(feature),
    getImlEnrichment: jest.fn().mockResolvedValue({
      records: [{ sourceId: 1 }],
      unavailable: false,
    }),
  };
  const mapper = { toDetail: jest.fn().mockReturnValue(detail) };
  const resolver = new MapFeaturesResolver(
    queryService as unknown as MapFeaturesQueryService,
    mapper as unknown as MapFeaturesMapperService,
    new ValidatorsService()
  );

  expect(await resolver.getFeatureById(feature.id)).toBe(detail);
  expect(queryService.getImlEnrichment).not.toHaveBeenCalled();
  expect(await Promise.all([
    resolver.imlRecords(detail),
    resolver.imlUnavailable(detail),
  ])).toEqual([[{ sourceId: 1 }], false]);
  expect(queryService.getImlEnrichment).toHaveBeenCalledTimes(1);
});
