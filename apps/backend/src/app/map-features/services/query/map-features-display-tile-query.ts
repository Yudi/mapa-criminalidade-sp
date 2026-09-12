import {
  DENSITY_HEXAGON_EDGE_METERS,
  MapFeaturesTileParams,
} from '@mapa-criminalidade/shared-types';
import { appendSqlFilters } from './map-features-query-sql';
import { SqlParam } from './map-features-tile-query';

/** Full cells are counted before clipping to a tile; edges never change with zoom. */
export function buildDisplayTileQuery(params: MapFeaturesTileParams): {
  sql: string;
  values: SqlParam[];
} {
  const values: SqlParam[] = [params.z, params.x, params.y];
  const conditions = ['geom IS NOT NULL'];
  appendSqlFilters(conditions, values, 4, params, { includeBounds: false });
  const where = conditions.join(' AND ');
  const edge = DENSITY_HEXAGON_EDGE_METERS;

  if (params.mode === 'density') {
    return {
      values,
      sql: `
      WITH bounds AS (SELECT ST_TileEnvelope($1, $2, $3) AS envelope),
      cells AS MATERIALIZED (
        SELECT i, j, hex.geom AS cell_geom, ST_Transform(hex.geom, 4326) AS cell_wgs
        FROM bounds CROSS JOIN LATERAL ST_HexagonGrid(${edge}, ST_Expand(envelope, ${
        edge * 2
      })) hex
      ),
      assigned AS (
        -- A point on an edge belongs to the first cell only, including at tile seams.
        SELECT DISTINCT ON (id) id, i, j
        FROM cells JOIN map_features ON geom && cell_wgs
          AND ST_Covers(cell_geom, ST_Transform(geom, 3857))
        WHERE ${where}
        ORDER BY id, i, j
      ),
      counts AS (
        SELECT i, j, COUNT(*) AS occurrence_count FROM assigned GROUP BY i, j
      ),
      polygons AS (
        SELECT i::text || ':' || j::text AS cell_id, occurrence_count,
          ST_SetSRID(ST_Hexagon(${edge}, i, j), 3857) AS cell_geom
        FROM counts
      ),
      tile_data AS (
        SELECT cell_id, occurrence_count,
          ST_AsMVTGeom(cell_geom, envelope, 4096, 0, true) AS mvt_geom
        FROM polygons CROSS JOIN bounds WHERE ST_Intersects(cell_geom, envelope)
      )
      SELECT ST_AsMVT(tile_data, 'occurrences', 4096, 'mvt_geom') AS mvt
      FROM tile_data WHERE mvt_geom IS NOT NULL
    `,
    };
  }

  // Keep individual markers bounded and advertise incomplete tiles to the existing UI.
  const categorySql = params.categories?.length
    ? `(SELECT min(name) FROM unnest(search_categories) AS names(name)
        WHERE name IN (SELECT jsonb_array_elements_text($${
          values.length + 1
        }::jsonb)))`
    : 'category';
  if (params.categories?.length) values.push(JSON.stringify(params.categories));
  return {
    values,
    sql: `
    WITH bounds AS (SELECT ST_TileEnvelope($1, $2, $3) AS envelope),
    selected AS (
      SELECT id, num_bo, ano_bo, delegacia, category, search_categories, geom,
        COUNT(*) OVER () AS tile_total
      FROM map_features CROSS JOIN bounds
      WHERE geom && ST_Transform(envelope, 4326) AND ${where}
      ORDER BY id LIMIT 50000
    ),
    tile_data AS (
      SELECT id::text AS feature_id, num_bo, ano_bo, delegacia,
        ${categorySql} AS category,
        1 AS server_singleton, CASE WHEN tile_total > 50000 THEN 1 END AS truncated,
        ST_AsMVTGeom(ST_Transform(geom, 3857), envelope, 4096, 256, true) AS mvt_geom
      FROM selected CROSS JOIN bounds
    )
    SELECT ST_AsMVT(tile_data, 'occurrences', 4096, 'mvt_geom') AS mvt
    FROM tile_data WHERE mvt_geom IS NOT NULL
  `,
  };
}
