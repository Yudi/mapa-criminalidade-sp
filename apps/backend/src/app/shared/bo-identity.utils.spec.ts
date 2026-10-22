import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getModernBoNumber, modernBoExpression } from './bo-identity.utils';

describe('modern BO identity', () => {
  it.each(['BQ4691', 'BQ4691-1', 'BQ4691-2', 'BQ4691-123', ' bq4691-2 '])(
    'recognizes %s as an edition of the same BO',
    (value) => expect(getModernBoNumber(value, 2025)).toBe('BQ4691')
  );

  it('recognizes SPJ identifiers during the 2021 transition', () => {
    expect(getModernBoNumber('AA1234-2', 2021)).toBe('AA1234');
  });

  it.each<[string, number]>([
    ['1234', 2025],
    ['BQ4691', 2020],
    ['BQ4691', 2025.5],
    ['BQ4691', Number.NaN],
    ['AA0000-1', 2025],
    ['BQ4691-0', 2025],
    ['BQ4691-01', 2025],
    ['BQ4691-1-2', 2025],
    ['BQ4691/2025', 2025],
    ['BQ4691 2', 2025],
    ['BQ4691-extra', 2025],
    ['BQ 4691-2', 2025],
    ['B4691-2', 2025],
    ['BQQ4691-2', 2025],
  ])('keeps %s (%s) on strict unit matching', (value, year) => {
    expect(getModernBoNumber(value, year)).toBeNull();
  });

  it('keeps the pending index expressions aligned with the lookup parser', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20261021000000_iml_modern_bo_lookup/migration.sql'
      ),
      'utf8'
    );
    expect(migration).toContain(modernBoExpression('NUM_BO'));
    expect(migration).toContain(modernBoExpression('num_bo'));
  });
});
