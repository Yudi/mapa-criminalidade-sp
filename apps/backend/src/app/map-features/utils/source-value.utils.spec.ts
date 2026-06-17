import {
  formatSourceDateOnly,
  parseSourceBooleanFlag,
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
  });

  it('normalizes common source date values to date-only API strings', () => {
    expect(formatSourceDateOnly('2024-01-15')).toBe('2024-01-15');
    expect(formatSourceDateOnly('15/01/2024')).toBe('2024-01-15');
    expect(formatSourceDateOnly('45292.5')).toBe('2024-01-01');
  });

  it('parses source boolean flags', () => {
    expect(parseSourceBooleanFlag('S')).toBe(true);
    expect(parseSourceBooleanFlag('N')).toBe(false);
    expect(parseSourceBooleanFlag('')).toBeUndefined();
  });
});
