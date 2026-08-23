import { BadRequestException } from '@nestjs/common';
import { ValidatorsService } from '../../shared/validators/validators.service';
import {
  MAX_FILTER_DATE_SPAN_DAYS,
  MAX_FILTER_ITEM_LENGTH,
  MAX_FILTER_LIST_ITEMS,
  parseStringListQuery,
  normalizeLookup,
  validateBounds,
  validateDateFilters,
  validateFilterInput,
} from './map-feature-request.utils';

describe('map feature request limits', () => {
  const validators = new ValidatorsService();

  it('parses JSON list values without splitting commas inside labels', () => {
    expect(
      parseStringListQuery(JSON.stringify(['A, B', 'À tarde']))
    ).toEqual(['A, B', 'À tarde']);
  });

  it('rejects oversized lists and values before query execution', () => {
    expect(() =>
      validateFilterInput(validators, {
        categories: Array.from({ length: MAX_FILTER_LIST_ITEMS + 1 }, () => 'x'),
      })
    ).toThrow(BadRequestException);

    expect(() =>
      validateFilterInput(validators, {
        periods: ['x'.repeat(MAX_FILTER_ITEM_LENGTH + 1)],
      })
    ).toThrow(BadRequestException);
  });

  it('rejects date ranges beyond the read-path budget', () => {
    expect(() =>
      validateDateFilters(validators, '2026-01-01', '1800-01-01')
    ).toThrow(
      `Date range cannot exceed ${MAX_FILTER_DATE_SPAN_DAYS} days`
    );
  });

  it('rejects world-sized bounds while allowing a Brazil-sized envelope', () => {
    expect(() =>
      validateBounds(validators, {
        minLon: -180,
        minLat: -90,
        maxLon: 180,
        maxLat: 90,
      })
    ).toThrow(BadRequestException);

    expect(() =>
      validateBounds(validators, {
        minLon: -74,
        minLat: -34,
        maxLon: -34,
        maxLat: 6,
      })
    ).not.toThrow();
  });

  it('bounds BO lookup identifiers and years without requiring legacy delegacia', () => {
    expect(normalizeLookup({ numBo: ' 123 ', anoBo: 2021 })).toEqual({
      numBo: '123',
      anoBo: 2021,
      delegacia: null,
    });
    expect(() => normalizeLookup({ numBo: 'x'.repeat(161) })).toThrow(
      BadRequestException
    );
    expect(() => normalizeLookup({ numBo: '123', anoBo: 1799 })).toThrow(
      BadRequestException
    );
  });
});
