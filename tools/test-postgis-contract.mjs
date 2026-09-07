// Run only against a disposable, empty database ending in _test.
// This script applies migrations; never point it at the application database.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import MVT from 'ol/format/MVT.js';

const connectionString = process.env.TEST_DATABASE_URL;
assert(connectionString, 'TEST_DATABASE_URL is required');
const db = new Client({ connectionString });
await db.connect();
try {
  const { rows: [identity] } = await db.query('SELECT current_database() AS name, to_regclass(\'public.map_features\') AS existing');
  assert(identity.name.endsWith('_test'), 'Use a disposable database ending in _test');
  assert.equal(identity.existing, null, 'The test database must be empty');
  execFileSync('bunx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'inherit',
  });
  const chartSource = await readFile(new URL('../apps/backend/src/app/map-features/services/query/map-features-query-sql.ts', import.meta.url), 'utf8');
  const quantityExpression = /const RECORD_QUANTITY_SQL = `([\s\S]*?)`;/.exec(chartSource)?.[1];
  assert(quantityExpression, 'Could not locate the actual chart quantity SQL expression');
  for (const [value, expected] of [['0', '0'], ['2', '2'], ['2147483648', '2147483648'], ['9'.repeat(100), null], ['1,5', null]]) {
    const { rows: [row] } = await db.query(`SELECT (${quantityExpression})::text AS amount FROM (VALUES ($1::jsonb)) record(value)`, [JSON.stringify({ quantidade: value })]);
    assert.equal(row.amount, expected);
  }
  const source = (table, date, location) => ({
    records: [{ source_table: table, source_id: 1, type: 'celular', rubrica: table }],
    _source_metadata: { [table]: {
      location: { bairro: location }, occurrence: { data_ocorrencia: date },
      category: table, rubrica_for_styling: table, data_ocorrencia: date, all_rubricas: [table],
    } },
  });
  const a = source('A', '2026-01-01', 'Centro');
  const b = source('B', '2026-02-01', 'Norte');
  const merge = async (left, right, removed = null) => (await db.query(
    'SELECT public.map_features_merge_source_data($1::jsonb, $2::jsonb, $3::text) AS data',
    [JSON.stringify(left), JSON.stringify(right), removed]
  )).rows[0].data;
  assert.deepEqual(await merge(a, b), await merge(b, a));
  const remaining = await merge(await merge(a, b), {}, 'A');
  assert.equal(remaining._canonical.category, 'B');
  assert.equal(remaining._canonical.data_ocorrencia, '2026-02-01');
  assert.equal(remaining.location.bairro, 'Norte');
  assert.equal(remaining.records.length, 1);
  assert.deepEqual(remaining.all_rubricas, ['B']);
  const ids = ['019ed000-0000-7000-8000-000000000001', '019ed000-0000-7000-8000-000000000002'];
  for (const [index, id] of ids.entries()) {
    await db.query(`INSERT INTO map_features
      (id, num_bo, ano_bo, delegacia, latitude, longitude, location_hash, geom,
       category, rubrica_for_styling, data_ocorrencia, source_tables, feature_data)
      VALUES ($1, 'SHARED-BO', 2026, 'DP', -23.55, $2, $3,
        ST_SetSRID(ST_MakePoint(($2::numeric)::double precision, (-23.55)::double precision), 4326), $4, $4, '2026-03-01',
        ARRAY['celulares_2026'], $5::jsonb)`,
    [id, -46.63 + index * 0.00001, `location-${index}`, index ? 'Roubo' : 'Furto', JSON.stringify({ records: [], occurrence: {}, location: {}, all_rubricas: [index ? 'Roubo' : 'Furto'] })]);
  }
  const tile = (zoom) => {
    const n = 2 ** zoom;
    const lat = -23.55 * Math.PI / 180;
    return [zoom, Math.floor((-46.63 + 180) / 360 * n), Math.floor((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * n)];
  };
  const load = async (zoom, filters = {}) => {
    const { rows: [row] } = await db.query('SELECT public.occurrences($1, $2, $3, $4::json) AS mvt', [...tile(zoom), JSON.stringify(filters)]);
    return new MVT().readFeatures(new Uint8Array(row.mvt).buffer);
  };
  assert.deepEqual((await load(16)).map((feature) => feature.get('feature_id')).sort(), ids);
  const clusters = await load(10);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].get('server_cluster'), 1);
  assert.equal(clusters[0].get('cluster_count'), 2);
  assert.equal(clusters[0].get('category'), 'Múltiplas categorias');
  const singleton = await load(10, { categories: ['Furto'] });
  assert.equal(singleton[0].get('feature_id'), ids[0]);
  for (const filters of [{ before: '2026-02-30' }, { startHour: 8 }, { startHour: [8, 9], endHour: 10 }, { categories: [1] }, { periods: Array(201).fill('x') }]) {
    await assert.rejects(load(16, filters), { code: '22023' });
  }
  const { rows: [rounding] } = await db.query('SELECT ROUND(-23.5000005::numeric, 6)::text AS a, ROUND(-23.5000006::numeric, 6)::text AS b');
  assert.equal(rounding.a, rounding.b);
  const reader = new Client({ connectionString });
  await reader.connect();
  try {
    await reader.query('BEGIN');
    await reader.query('SELECT 1 FROM map_feature_tile_points LIMIT 1');
    await db.query("SET lock_timeout = '500ms'");
    await db.query('SELECT public.ensure_map_feature_tile_partitions(5)');
  } finally {
    await reader.query('ROLLBACK');
    await reader.end();
  }
  execFileSync('bunx', ['jest', '--config', 'apps/backend/jest.config.ts', '--runInBand', '--runTestsByPath', 'apps/backend/src/app/map-features/services/map-features-etl-identity.spec.ts'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, TEST_DATABASE_URL: connectionString },
    stdio: 'inherit',
  });
  console.log('PostGIS migration, MVT identity/filter, ETL identity, rounding, and no-op partition contracts passed.');
} finally {
  await db.end();
}
