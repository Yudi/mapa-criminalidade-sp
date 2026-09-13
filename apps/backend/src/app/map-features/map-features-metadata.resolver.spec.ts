import { buildSchema, graphql } from 'graphql';
import { MapFeaturesResolver } from './map-features.resolver';
import { MapFeaturesQueryService } from './services/map-features-query.service';
import { MapFeaturesMapperService } from './services/map-features-mapper.service';
import { ValidatorsService } from '../shared/validators/validators.service';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const startupQuerySource = readFileSync(
  resolve(__dirname, '../../../../frontend/src/app/shared/map-features.graphql.ts'),
  'utf8'
);
const startupQuery = startupQuerySource.split('export const MAP_FEATURES_METADATA_QUERY = `')[1].split('`;')[0];

const schema = buildSchema(`
  type Category { name: String!, count: Int! }
  type Period { name: String!, count: Int! }
  type DateRange { earliest: String, latest: String, defaultAfter: String }
  type Metadata {
    datasetRevision: String!, format: String!, minZoom: Int!, maxZoom: Int!,
    layers: [String!]!, tileUrlTemplate: String!, dateRange: DateRange!,
    availableCategories: [String!]!, availableRubricas: [String!]!,
    availablePeriods: [String!]!, categoryStats: [Category!]!,
    periodStats: [Period!]!, totalFeatures: Int!
  }
  type Query { mapFeaturesMetadata: Metadata! }
`);

describe('map metadata lazy aggregates', () => {
  const service = {
    getDatasetRevision: jest.fn(),
    getDateRange: jest.fn(),
    getCategoryPeriodStats: jest.fn(),
    getCount: jest.fn(),
  };
  const resolver = new MapFeaturesResolver(
    service as unknown as MapFeaturesQueryService,
    {} as MapFeaturesMapperService,
    new ValidatorsService()
  );
  const execute = (source: string) => graphql({
    schema,
    source,
    rootValue: { mapFeaturesMetadata: () => resolver.getMetadata() },
  });

  beforeEach(() => {
    jest.resetAllMocks();
    service.getDatasetRevision.mockResolvedValue('1');
    service.getDateRange.mockResolvedValue({ latest: '2026-09-13' });
    service.getCategoryPeriodStats.mockResolvedValue({
      categories: [{ name: 'Furto', count: 4 }],
      periods: [{ name: 'À noite', count: 2 }],
    });
    service.getCount.mockResolvedValue(4);
  });

  it('executes the actual startup selection without global scans', async () => {
    const result = await execute(startupQuery);
    expect(result.errors).toBeUndefined();
    expect(result.data?.mapFeaturesMetadata).toMatchObject({
      datasetRevision: '1', dateRange: { latest: '2026-09-13' },
    });
    expect(service.getCategoryPeriodStats).not.toHaveBeenCalled();
    expect(service.getCount).not.toHaveBeenCalled();
  });

  it('preserves requested aggregates and shares scans across aliases and fragments', async () => {
    const result = await execute(`
      query { mapFeaturesMetadata {
        ...Stats categoryStats { name count } periodStats { name count }
        totalFeatures otherCount: totalFeatures
      } }
      fragment Stats on Metadata {
        availableCategories availableRubricas availablePeriods
        otherCategories: availableCategories
      }
    `);
    expect(result.errors).toBeUndefined();
    expect(result.data?.mapFeaturesMetadata).toMatchObject({
      availableCategories: ['Furto'], availableRubricas: ['Furto'],
      availablePeriods: ['À noite'], totalFeatures: 4, otherCount: 4,
      categoryStats: [{ name: 'Furto', count: 4 }],
    });
    expect(service.getCategoryPeriodStats).toHaveBeenCalledTimes(1);
    expect(service.getCount).toHaveBeenCalledTimes(1);
  });

  it('rejects aggregates when the dataset changes during their scan', async () => {
    service.getCategoryPeriodStats.mockImplementation(async () => {
      service.getDatasetRevision.mockResolvedValue('2');
      return { categories: [], periods: [] };
    });
    const result = await execute('{ mapFeaturesMetadata { categoryStats { name } } }');
    expect(result.errors?.[0].message).toContain('Dataset changed');
  });
});
