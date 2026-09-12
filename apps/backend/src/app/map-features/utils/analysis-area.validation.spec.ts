import { BadRequestException } from '@nestjs/common';
import { validateAnalysisArea } from './analysis-area.validation';
import {
  validateFilterInput,
  toQueryParams,
} from './map-feature-request.utils';
import { ValidatorsService } from '../../shared/validators/validators.service';
import { appendSqlFilters } from '../services/query/map-features-query-sql';
import {
  buildMapFeaturesCacheKey,
  normalizeMapFeaturesFilterParams,
} from '../services/query/map-features-query-cache';

const polygon = (coordinates: number[][]) => ({
  polygon: JSON.stringify({ type: 'Polygon', coordinates: [coordinates] }),
});
const neighborhood = polygon([
  [-46.65, -23.56],
  [-46.63, -23.56],
  [-46.63, -23.54],
  [-46.65, -23.54],
  [-46.65, -23.56],
]);

describe('analysis area', () => {
  it('accepts a neighborhood, a metropolitan envelope and a concave polygon', () => {
    for (const area of [
      neighborhood,
      polygon([
        [-46.65, -23.56],
        [-46.64, -23.56],
        [-46.63, -23.56],
        [-46.63, -23.54],
        [-46.65, -23.54],
        [-46.65, -23.56],
      ]),
      polygon([
        [-47, -24],
        [-46.2, -24],
        [-46.2, -23.2],
        [-47, -23.2],
        [-47, -24],
      ]),
      polygon([
        [-46.65, -23.56],
        [-46.63, -23.56],
        [-46.64, -23.55],
        [-46.63, -23.54],
        [-46.65, -23.54],
        [-46.65, -23.56],
      ]),
    ])
      expect(() => validateAnalysisArea(area)).not.toThrow();
  });

  it.each([
    { polygon: 'not json' },
    { polygon: 'x'.repeat(20001) },
    {
      polygon: JSON.stringify({
        type: 'Polygon',
        coordinates: [],
        extra: 'あ'.repeat(7000),
      }),
    },
    { polygon: JSON.stringify({ type: 'Point', coordinates: [0, 0] }) },
    polygon([
      [0, 0],
      [1, 0],
      [0, 1],
    ]),
    polygon([
      [0, 0],
      [1, 1],
      [0, 1],
      [1, 0],
      [0, 0],
    ]),
    polygon([
      [0, 0],
      [0.5, 0],
      [1, 0],
      [0, 0],
    ]),
    polygon([
      [0, 0],
      [0.5, 0],
      [0.25, 0],
      [0.25, 0.5],
      [0, 0],
    ]),
    polygon([
      [0, 0],
      [0, 0],
      [0, 1],
      [0, 0],
    ]),
    polygon([
      [181, 0],
      [181, 1],
      [180, 1],
      [181, 0],
    ]),
    polygon([
      [-48, -25],
      [-44, -25],
      [-44, -21],
      [-48, -25],
    ]),
    // Thin polygon with a large candidate envelope.
    polygon([
      [0, 0],
      [1.5, 1.5],
      [1.499, 1.5],
      [0, 0],
    ]),
    polygon(Array.from({ length: 102 }, (_, i) => [Math.cos(i), Math.sin(i)])),
    { ...neighborhood, radius: 10 },
    { longitude: 0, latitude: 0, radius: 0 },
    { longitude: 0, latitude: 0, radius: 10001 },
    { longitude: 0, latitude: NaN, radius: 100 },
    { longitude: 0, radius: 100 },
    {},
  ])('rejects malformed or expensive input %j', (area) => {
    expect(() => validateAnalysisArea(area)).toThrow(BadRequestException);
  });

  it('accepts radius endpoints and zero coordinates', () => {
    for (const radius of [1, 10000]) {
      expect(() =>
        validateAnalysisArea({ longitude: 0, latitude: 0, radius })
      ).not.toThrow();
    }
  });

  it('rejects mixed viewport and area filters and preserves a valid area', () => {
    const validators = new ValidatorsService();
    expect(() =>
      validateFilterInput(validators, {
        area: neighborhood,
        bounds: { minLon: -47, minLat: -24, maxLon: -46, maxLat: -23 },
      })
    ).toThrow(BadRequestException);
    expect(toQueryParams({ area: neighborhood }).area).toEqual(neighborhood);
  });

  it('uses an index envelope plus exact inclusive polygon coverage with parameters', () => {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    const next = appendSqlFilters(conditions, params, 1, {
      afterDate: '2026-01-01',
      categories: ['Furto'],
      area: neighborhood,
    });
    expect(next).toBe(4);
    expect(conditions.join(' AND ')).toContain(
      'geom && ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)'
    );
    expect(conditions.join(' AND ')).toContain(
      'ST_Covers(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), geom)'
    );
    expect(params).toEqual(['2026-01-01', 'Furto', neighborhood.polygon]);
  });

  it('uses indexed geography distance in meters for radius statistics', () => {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    expect(
      appendSqlFilters(conditions, params, 1, {
        area: { longitude: -46.6, latitude: -23.5, radius: 500 },
      })
    ).toBe(4);
    expect(conditions[0]).toContain('ST_DWithin(geom::geography');
    expect(params).toEqual([-46.6, -23.5, 500]);
  });

  it('isolates shapes, radii and viewport cache keys', () => {
    const key = (area?: Parameters<typeof validateAnalysisArea>[0]) =>
      buildMapFeaturesCacheKey(
        'charts',
        normalizeMapFeaturesFilterParams({ area })
      );
    const keys = [
      key(),
      key(neighborhood),
      key(
        polygon([
          [-46.65, -23.56],
          [-46.63, -23.56],
          [-46.65, -23.54],
          [-46.65, -23.56],
        ])
      ),
      key({ longitude: -46.6, latitude: -23.5, radius: 500 }),
      key({ longitude: -46.6, latitude: -23.5, radius: 1000 }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});
