import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildChartsQuery } from './map-features-query-sql';

// Run only in the existing disposable, migrated PostGIS contract lane.
const describePostgis = process.env.TEST_DATABASE_URL
  ? describe
  : describe.skip;

describePostgis('fixed density and weekday/hour aggregation (PostGIS)', () => {
  it('counts complete cells consistently across neighboring tiles and zooms, preserving unknown times', async () => {
    const client = new Client({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    await client.connect();
    try {
      const identity = await client.query<{ name: string }>(
        'SELECT current_database() AS name'
      );
      expect(identity.rows[0].name.endsWith('_test')).toBe(true);
      await client.query('BEGIN');
      // Transaction-local fixture shadows the application table and leaves no persistent data.
      await client.query(`CREATE TEMP TABLE map_features (
        id integer, geom geometry(Point, 4326), num_bo text, ano_bo integer, delegacia text,
        category text, search_categories text[], all_rubricas text[], periodo_normalized text,
        data_ocorrencia date, hora_ocorrencia integer, total_records integer, feature_data jsonb
      ) ON COMMIT DROP`);
      await client.query(`INSERT INTO map_features
        SELECT id, ST_Transform(ST_SetSRID(ST_MakePoint(x, y), 3857), 4326), id::text, 2026, 'DP',
          'Furto', ARRAY['Furto'], ARRAY['Furto'], NULL, day::date, hour, 5,
          '{"records": [], "location": {}, "occurrence": {}}'::jsonb
        FROM (VALUES
          (1, 0, 0, '2026-09-07', 0),
          (2, 1, 1, '2026-09-07', NULL),
          (3, -1, -1, NULL, 12),
          (4, 500, 0, NULL, NULL)
        ) points(id, x, y, day, hour)`);
      await client.query(`CREATE TEMP TABLE map_feature_tile_points ON COMMIT DROP AS
        SELECT *, ST_Transform(geom, 3857) AS geom_3857 FROM map_features`);
      const migration = readFileSync(
        resolve(
          process.cwd(),
          'prisma/migrations/20260912210000_martin_display_modes/migration.sql'
        ),
        'utf8'
      );
      const densitySql = migration
        .slice(
          migration.indexOf('    WITH cells AS MATERIALIZED'),
          migration.indexOf('  ELSIF z < 16')
        )
        .replace(' INTO mvt', '')
        .replace(/;\s*$/, '')
        .replace(/\btile_envelope\b/g, 'ST_TileEnvelope($1, $2, $3)')
        .replace(/\bcategory_filter\b/g, "ARRAY['Furto']::text[]")
        .replace(/\bperiod_filter\b/g, 'NULL::text[]')
        .replace(/\bweekday_filter\b/g, 'NULL::integer[]')
        .replace(/\b(before_date|after_date)\b/g, 'NULL::date')
        .replace(/\b(start_hour|end_hour)\b/g, 'NULL::integer')
        .replace(/\bdetail_filters\b/g, "'{}'::jsonb");
      let baselineCount: number | undefined;
      for (const [z, x, y] of [
        [16, 32768, 32767],
        [16, 32767, 32768],
        [15, 16384, 16383],
      ]) {
        const query = { sql: densitySql, values: [z, x, y] };
        const result = await client.query(query.sql, query.values);
        expect(result.rows[0].mvt.length).toBeGreaterThan(0);
        // Inspect the same production CTE before MVT serialization to verify full cell counts.
        const countsSql =
          query.sql.slice(0, query.sql.lastIndexOf('SELECT ST_AsMVT(')) +
          'SELECT cell_id, occurrence_count::int FROM tile_data WHERE mvt_geom IS NOT NULL';
        const counts = await client.query(countsSql, query.values);
        const count = counts.rows.find(
          (row: { cell_id: string }) => row.cell_id === '0:0'
        )?.occurrence_count;
        // Reprojection may put the vertex fixture infinitesimally on either side;
        // all zooms/tiles must still agree on the exact same cell count.
        expect(count).toBeGreaterThanOrEqual(3);
        baselineCount ??= count;
        expect(count).toBe(baselineCount);
        const totals = await client.query(
          query.sql.slice(0, query.sql.lastIndexOf('SELECT ST_AsMVT(')) +
            'SELECT SUM(occurrence_count)::int AS total FROM counts',
          query.values
        );
        expect(totals.rows[0].total).toBe(4);
      }
      const {
        rows: [charts],
      } = await client.query(buildChartsQuery('TRUE'));
      expect(Number(charts.total_features)).toBe(4);
      expect(charts.weekday_hour_distribution).toEqual(
        expect.arrayContaining([
          { weekday: 1, hour: 0, count: 1 },
          { weekday: 1, hour: null, count: 1 },
          { weekday: null, hour: 12, count: 1 },
          { weekday: null, hour: null, count: 1 },
        ])
      );
      // Midnight is included by a wraparound filter; unknown hours are not inferred.
      const overnight = await client.query(
        buildChartsQuery('(hora_ocorrencia >= 22 OR hora_ocorrencia <= 4)')
      );
      expect(overnight.rows[0].weekday_hour_distribution).toEqual([
        { weekday: 1, hour: 0, count: 1 },
      ]);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});
