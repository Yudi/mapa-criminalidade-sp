import { BadRequestException } from '@nestjs/common';
import {
  isValidAnalysisArea,
  occurrencesPer100k,
} from '@mapa-criminalidade/shared-types';
import { validateCensusReference } from './census.service';
import { appendSqlFilters } from '../map-features/services/query/map-features-query-sql';
import { MapFeaturesStatsQuery } from '../map-features/services/query/map-features-stats-query';
import { PrismaService } from '../prisma/prisma.service';

const census = {
  releaseId: 'ibge-2022-sp-20260520-v1',
  level: 'neighborhood' as const,
  code: '3507100013',
};

describe('Census geography and rate contract', () => {
  it('never fabricates a denominator or annualizes a period count', () => {
    expect(occurrencesPer100k(50, 20_000)).toBe(250);
    expect(occurrencesPer100k(0, 20_000)).toBe(0);
    expect(occurrencesPer100k(50, 0)).toBeNull();
    expect(occurrencesPer100k(50, null)).toBeNull();
  });
  it('accepts only SP references and rejects mixed geometry requests', () => {
    expect(isValidAnalysisArea({ census })).toBe(true);
    expect(isValidAnalysisArea({ census, polygon: '{}' })).toBe(false);
    expect(
      isValidAnalysisArea({ census: { ...census, code: '3307100013' } })
    ).toBe(false);
    expect(() =>
      validateCensusReference(
        census.releaseId,
        census.level,
        "35'; DROP TABLE census_areas"
      )
    ).toThrow(BadRequestException);
  });
  it('uses full official geometry and preserves the complete filter set', () => {
    const conditions: string[] = [],
      values: (string | number)[] = [];
    appendSqlFilters(conditions, values, 1, {
      area: { census },
      afterDate: '2022-01-01',
      beforeDate: '2022-12-31',
      categories: ['Furto'],
      weekdays: [1],
      startHour: 22,
      endHour: 4,
      vehicleBrands: ['Ford'],
    });
    const sql = conditions.join(' AND ');
    expect(sql).toContain('ST_Covers');
    expect(sql).toContain('SELECT geom FROM census_areas');
    expect(sql).not.toContain('ST_Simplify');
    expect(sql).toContain('map_feature_matches_details');
    expect(values.slice(-3)).toEqual([
      census.releaseId,
      census.level,
      census.code,
    ]);
    expect(sql).not.toContain(census.code);
  });
  it('does not fall back to a statewide count when only an official area is selected', async () => {
    const executeReadOnlyStatsQuery = jest
      .fn()
      .mockResolvedValue([{ count: '17' }]);
    const stats = new MapFeaturesStatsQuery(
      { executeReadOnlyStatsQuery } as unknown as PrismaService,
      async (_scope, _payload, _ttl, loader) => loader()
    );
    await expect(stats.getCount({ area: { census } })).resolves.toBe(17);
    expect(executeReadOnlyStatsQuery.mock.calls[0][0]).toContain(
      'census_areas'
    );
    expect(executeReadOnlyStatsQuery.mock.calls[0].slice(1)).toEqual([
      census.releaseId,
      census.level,
      census.code,
    ]);
  });
});
