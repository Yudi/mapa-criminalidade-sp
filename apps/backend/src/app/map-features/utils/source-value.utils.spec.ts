import {
  formatSourceDateOnly,
  parseSourceBooleanFlag,
  parseSourceDate,
  parseSourceInteger,
  parseSourceNumber,
} from './source-value.utils';

describe('source value utils', () => {
  it('parses numbers stored as raw text with Brazilian decimal separators', () => {
    expect(parseSourceNumber('12,5')).toBe(12.5);
    expect(parseSourceNumber('1.234,56')).toBe(1234.56);
    expect(parseSourceNumber('-23,5505')).toBe(-23.5505);
  });

  it('parses integer-like source values without requiring typed database columns', () => {
    expect(parseSourceInteger('2026.0')).toBe(2026);
    expect(parseSourceInteger('34')).toBe(34);
    expect(parseSourceInteger('')).toBeNull();
    expect(parseSourceInteger('2026.5')).toBeNull();
  });

  it('normalizes common source date values to date-only API strings', () => {
    expect(formatSourceDateOnly('2024-01-15')).toBe('2024-01-15');
    expect(formatSourceDateOnly('15/01/2024')).toBe('2024-01-15');
    expect(formatSourceDateOnly('45292.5')).toBe('2024-01-01');
  });

  it('rejects invalid, trailing, and implementation-dependent dates', () => {
    expect(parseSourceDate('31/02/2024')).toBeNull();
    expect(parseSourceDate('15/01/2024 trailing')).toBeNull();
    expect(parseSourceDate('January 15, 2024')).toBeNull();
    expect(parseSourceDate('2024-02-29 25:00:00')).toBeNull();
    expect(formatSourceDateOnly('2024-02-29 23:59:59')).toBe('2024-02-29');
  });

  it('rejects malformed numeric input without changing source decimal conventions', () => {
    expect(parseSourceNumber('12.5 trailing')).toBeNull();
    expect(parseSourceNumber('1,2,3')).toBeNull();
    expect(parseSourceNumber('-46.6248993')).toBe(-46.6248993);
  });

  it('parses source boolean flags', () => {
    expect(parseSourceBooleanFlag('S')).toBe(true);
    expect(parseSourceBooleanFlag('N')).toBe(false);
    expect(parseSourceBooleanFlag('')).toBeUndefined();
  });
});
