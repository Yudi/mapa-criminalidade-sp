import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('occurrence tile contract migration', () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      'prisma/migrations/20260823170000_harden_etl_and_tile_contract/migration.sql'
    ),
    'utf8'
  );

  it('keeps partitions ahead of the business year and drains default rows safely', () => {
    expect(migration).toContain('ensure_map_feature_tile_partitions');
    expect(migration).toContain('map_feature_tile_points_default');
    expect(migration).toContain('ATTACH PARTITION');
  });

  it('uses safe date parsing and JSON arrays for filters', () => {
    expect(migration).toContain('map_features_try_iso_date');
    expect(migration).toContain(
      "json_typeof(query_params->'categories') = 'array'"
    );
    expect(migration).toContain(
      "json_typeof(query_params->'periods') = 'array'"
    );
  });

  it('orders dense tiles deterministically and labels mixed clusters', () => {
    expect(migration).toContain("ELSE 'Múltiplas categorias'");
    expect(migration).toContain('ORDER BY stable_order LIMIT 50000');
    expect(migration).toContain('AS truncated');
  });
});
