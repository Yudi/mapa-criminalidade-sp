import { appendSqlFilters, buildChartsQuery } from './map-features-query-sql';
import {
  buildMapFeaturesCacheKey,
  normalizeMapFeaturesFilterParams,
} from './map-features-query-cache';
import { toChartBucketsFromJson } from './map-features-result-mappers';
import {
  parseStringListQuery,
  parseWeekdayListQuery,
  toQueryParams,
  validateFilterInput,
} from '../../utils/map-feature-request.utils';
import { ValidatorsService } from '../../../shared/validators/validators.service';

describe('map detail filter boundaries', () => {
  const filters = {
    categories: ['Furto'],
    vehicleBrands: ["VW/Audi, D'Ávila"],
    objectTypes: ['Celular'],
    phoneBrandModels: ['Samsung · Galaxy'],
    locationTypes: ['Via pública'],
    weekdays: [1, 7],
  };

  it('validates and carries every dimension into the query and cache identity', () => {
    validateFilterInput(new ValidatorsService(), filters);
    expect(toQueryParams(filters)).toMatchObject(filters);
    const normalized = normalizeMapFeaturesFilterParams(filters);
    for (const key of [
      'vehicleBrands',
      'objectTypes',
      'phoneBrandModels',
      'locationTypes',
    ] as const) {
      expect(normalized[key]).toEqual(filters[key]);
      expect(buildMapFeaturesCacheKey('charts', normalized)).not.toBe(
        buildMapFeaturesCacheKey('charts', { ...normalized, [key]: undefined })
      );
      expect(() =>
        validateFilterInput(new ValidatorsService(), {
          [key]: ['x'.repeat(257)],
        })
      ).toThrow();
      expect(() =>
        validateFilterInput(new ValidatorsService(), {
          [key]: Array(201).fill('x'),
        })
      ).toThrow();
      expect(parseStringListQuery(JSON.stringify(filters[key]), key)).toEqual(
        filters[key]
      );
    }
    expect(parseWeekdayListQuery('[7,1,7]')).toEqual([1, 7]);
    expect(() => parseWeekdayListQuery('[0,8]')).toThrow();
    expect(() =>
      validateFilterInput(new ValidatorsService(), { weekdays: [1, 8] })
    ).toThrow();
  });

  it('combines category and detail constraints without interpolating user values into SQL', () => {
    const conditions: string[] = [];
    const values: (string | number)[] = [];
    expect(appendSqlFilters(conditions, values, 1, filters)).toBe(5);
    expect(conditions).toEqual([
      'search_categories && ARRAY[$1]::text[]',
      'EXTRACT(ISODOW FROM data_ocorrencia)::int IN ($2, $3)',
      'public.map_feature_matches_details(feature_data, $4::jsonb)',
    ]);
    expect(values[0]).toBe('Furto');
    expect(values.slice(1, 3)).toEqual([1, 7]);
    expect(JSON.parse(values[3] as string)).toEqual({
      vehicleBrands: filters.vehicleBrands,
      objectTypes: filters.objectTypes,
      phoneBrandModels: filters.phoneBrandModels,
      locationTypes: filters.locationTypes,
    });
    expect(conditions.join(' ')).not.toContain("D'Ávila");
  });

  it('retains exact selectable values and leaves unknown buckets unselectable', () => {
    expect(
      toChartBucketsFromJson([
        { label: 'Marca', filterValue: 'Marca', count: '2' },
        { label: 'Não informado', filterValue: null, count: 1 },
      ])
    ).toEqual([
      { label: 'Marca', filterValue: 'Marca', count: 2, amount: null },
      { label: 'Não informado', filterValue: null, count: 1, amount: null },
    ]);
    expect(buildChartsQuery('TRUE')).toContain("'filterValue', filter_value");
  });
});
