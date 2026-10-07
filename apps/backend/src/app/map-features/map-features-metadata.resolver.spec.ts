import { buildSchema, graphql, printSchema } from 'graphql';
import { createYoga } from 'graphql-yoga';
import { MapFeaturesResolver } from './map-features.resolver';
import { MapFeaturesQueryService } from './services/map-features-query.service';
import { MapFeaturesMapperService } from './services/map-features-mapper.service';
import { ValidatorsService } from '../shared/validators/validators.service';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createGraphqlOptions } from '../shared/graphql-options';

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

  it('delivers metadata before deferred aggregate scans finish', async () => {
    let finishCount!: (count: number) => void;
    service.getCount.mockReturnValue(new Promise<number>((resolve) => {
      finishCount = resolve;
    }));
    const incrementalSchema = buildSchema(printSchema(schema));
    const metadataField = incrementalSchema.getQueryType()?.getFields()['mapFeaturesMetadata'];
    if (!metadataField) throw new Error('Missing metadata field');
    metadataField.resolve = () => resolver.getMetadata();
    const options = createGraphqlOptions(false);
    const yoga = createYoga({
      schema: incrementalSchema,
      graphqlEndpoint: options.path,
      plugins: options.plugins,
      maskedErrors: false,
      logging: false,
    });
    const response = await yoga.fetch('http://localhost/api/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'multipart/mixed' },
      body: JSON.stringify({ query: `{
        mapFeaturesMetadata {
          datasetRevision
          dateRange { latest }
          ... @defer(label: "totals") { totalFeatures }
        }
      }` }),
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Missing response body');
    try {
      let first = '';
      while (!first.includes('"hasNext":true')) {
        const chunk = await reader.read();
        if (chunk.done) break;
        first += new TextDecoder().decode(chunk.value);
      }
      expect(first).toContain('"datasetRevision":"1"');
      expect(first).toContain('"hasNext":true');
      expect(first).not.toContain('"totalFeatures":');
      finishCount(4);
      let remaining = '';
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        remaining += new TextDecoder().decode(chunk.value);
      }
      expect(remaining).toContain('"totalFeatures":4');
      expect(remaining).toContain('"hasNext":false');
      expect(service.getCount).toHaveBeenCalledTimes(1);
      expect(service.getCategoryPeriodStats).not.toHaveBeenCalled();
    } finally {
      finishCount(4);
      await reader.cancel();
      await yoga.dispose();
    }
  });
});
