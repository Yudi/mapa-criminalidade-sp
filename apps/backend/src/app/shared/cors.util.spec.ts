import { parseAllowedOrigins } from './cors.util';

describe('parseAllowedOrigins', () => {
  it('trims, canonicalizes, and deduplicates origins', () => {
    expect(
      parseAllowedOrigins(
        ' https://Example.com , https://example.com/ , http://localhost:4200 ',
        []
      )
    ).toEqual(['https://example.com', 'http://localhost:4200']);
  });

  it.each([
    '',
    '*',
    'not-an-origin',
    'ftp://example.com',
    'https://example.com/path',
    'https://user:password@example.com',
  ])('rejects unsafe or malformed value %s', (value) => {
    expect(() => parseAllowedOrigins(value, [])).toThrow(/ALLOWED_ORIGINS/);
  });

  it('uses and validates fallback origins when no override is supplied', () => {
    expect(parseAllowedOrigins(undefined, ['http://localhost:4200'])).toEqual([
      'http://localhost:4200',
    ]);
    expect(() => parseAllowedOrigins(undefined, [])).toThrow(
      'ALLOWED_ORIGINS must contain at least one origin'
    );
  });
});
