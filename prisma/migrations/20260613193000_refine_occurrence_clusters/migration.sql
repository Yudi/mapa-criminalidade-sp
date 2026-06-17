CREATE OR REPLACE FUNCTION public.occurrences(
  z INTEGER,
  x INTEGER,
  y INTEGER,
  query_params JSON
)
RETURNS bytea
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
  mvt bytea;
  raw_categories TEXT := NULLIF(query_params->>'categories', '');
  raw_periods TEXT := NULLIF(query_params->>'periods', '');
  category_filter TEXT[];
  period_filter TEXT[];
  before_date DATE;
  after_date DATE;
  start_hour INTEGER;
  end_hour INTEGER;
  tile_envelope geometry := ST_TileEnvelope(z, x, y);
  grid_size DOUBLE PRECISION;
  cells_per_tile INTEGER;
BEGIN
  IF z < 10 OR z > 22 THEN
    RETURN NULL;
  END IF;

  IF COALESCE(query_params->>'before', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    before_date := (query_params->>'before')::DATE;
  END IF;

  IF COALESCE(query_params->>'after', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    after_date := (query_params->>'after')::DATE;
  END IF;

  IF COALESCE(query_params->>'startHour', '') ~ '^([0-9]|1[0-9]|2[0-3])$' THEN
    start_hour := (query_params->>'startHour')::INTEGER;
  END IF;

  IF COALESCE(query_params->>'endHour', '') ~ '^([0-9]|1[0-9]|2[0-3])$' THEN
    end_hour := (query_params->>'endHour')::INTEGER;
  END IF;

  IF raw_categories IS NOT NULL THEN
    SELECT array_agg(category ORDER BY category)
    INTO category_filter
    FROM (
      SELECT DISTINCT NULLIF(btrim(value), '') AS category
      FROM unnest(regexp_split_to_array(raw_categories, '\s*,\s*')) AS category_values(value)
    ) AS normalized_categories
    WHERE category IS NOT NULL;
  END IF;

  IF raw_periods IS NOT NULL THEN
    SELECT array_agg(period ORDER BY period)
    INTO period_filter
    FROM (
      SELECT DISTINCT public.map_features_normalize_period(value) AS period
      FROM unnest(regexp_split_to_array(raw_periods, '\s*,\s*')) AS period_values(value)
    ) AS normalized_periods
    WHERE period IS NOT NULL;
  END IF;

  IF z < 16 THEN
    -- Progressively reveal detail while keeping cluster symbols far enough
    -- apart to remain readable. This bounds each tile to 16-144 clusters.
    cells_per_tile := CASE z
      WHEN 10 THEN 4
      WHEN 11 THEN 5
      WHEN 12 THEN 6
      WHEN 13 THEN 8
      WHEN 14 THEN 10
      ELSE 12
    END;
    grid_size := (40075016.68557849 / power(2, z)) / cells_per_tile;

    SELECT ST_AsMVT(tile_data, 'occurrences', 4096, 'mvt_geom')
    INTO mvt
    FROM (
      WITH filtered AS (
        SELECT
          CASE
            WHEN category_filter IS NULL THEN mf.category
            ELSE COALESCE(
              (
                SELECT matched_category
                FROM unnest(mf.search_categories) AS matched_categories(matched_category)
                WHERE matched_category = ANY(category_filter)
                ORDER BY matched_category
                LIMIT 1
              ),
              mf.category
            )
          END AS category,
          mf.geom_3857
        FROM map_features mf
        WHERE mf.geom_3857 && tile_envelope
          AND (before_date IS NULL OR mf.data_ocorrencia <= before_date)
          AND (after_date IS NULL OR mf.data_ocorrencia >= after_date)
          AND (category_filter IS NULL OR mf.search_categories && category_filter)
          AND (period_filter IS NULL OR mf.periodo_normalized = ANY(period_filter))
          AND (
            start_hour IS NULL
            OR end_hour IS NULL
            OR (
              start_hour <= end_hour
              AND mf.hora_ocorrencia BETWEEN start_hour AND end_hour
            )
            OR (
              start_hour > end_hour
              AND (mf.hora_ocorrencia >= start_hour OR mf.hora_ocorrencia <= end_hour)
            )
          )
      ),
      binned AS (
        SELECT
          category,
          ST_X(geom_3857) AS point_x,
          ST_Y(geom_3857) AS point_y,
          floor(ST_X(geom_3857) / grid_size) AS cell_x,
          floor(ST_Y(geom_3857) / grid_size) AS cell_y
        FROM filtered
      ),
      clusters AS (
        SELECT
          min(category) AS category,
          count(*)::INTEGER AS cluster_count,
          ST_SetSRID(
            ST_MakePoint(
              avg(point_x),
              avg(point_y)
            ),
            3857
          ) AS cluster_geom
        FROM binned
        GROUP BY cell_x, cell_y
      )
      SELECT
        category,
        cluster_count,
        1 AS server_cluster,
        ST_AsMVTGeom(cluster_geom, tile_envelope, 4096, 64, true) AS mvt_geom
      FROM clusters
    ) AS tile_data
    WHERE mvt_geom IS NOT NULL;
  ELSE
    SELECT ST_AsMVT(tile_data, 'occurrences', 4096, 'mvt_geom')
    INTO mvt
    FROM (
      SELECT
        mf.num_bo,
        mf.ano_bo,
        mf.delegacia,
        CASE
          WHEN category_filter IS NULL THEN mf.category
          ELSE COALESCE(
            (
              SELECT matched_category
              FROM unnest(mf.search_categories) AS matched_categories(matched_category)
              WHERE matched_category = ANY(category_filter)
              ORDER BY matched_category
              LIMIT 1
            ),
            mf.category
          )
        END AS category,
        1 AS cluster_count,
        ST_AsMVTGeom(mf.geom_3857, tile_envelope, 4096, 256, true) AS mvt_geom
      FROM map_features mf
      WHERE mf.geom_3857 && tile_envelope
        AND (before_date IS NULL OR mf.data_ocorrencia <= before_date)
        AND (after_date IS NULL OR mf.data_ocorrencia >= after_date)
        AND (category_filter IS NULL OR mf.search_categories && category_filter)
        AND (period_filter IS NULL OR mf.periodo_normalized = ANY(period_filter))
        AND (
          start_hour IS NULL
          OR end_hour IS NULL
          OR (
            start_hour <= end_hour
            AND mf.hora_ocorrencia BETWEEN start_hour AND end_hour
          )
          OR (
            start_hour > end_hour
            AND (mf.hora_ocorrencia >= start_hour OR mf.hora_ocorrencia <= end_hour)
          )
        )
      LIMIT 50000
    ) AS tile_data
    WHERE mvt_geom IS NOT NULL;
  END IF;

  RETURN mvt;
END;
$$;

COMMENT ON FUNCTION public.occurrences(INTEGER, INTEGER, INTEGER, JSON) IS $tilejson$
{
  "description": "Zoom-aware filtered occurrence vector tiles for Mapa Criminalidade",
  "minzoom": 10,
  "maxzoom": 22,
  "content_type": "application/vnd.mapbox-vector-tile",
  "vector_layers": [
    {
      "id": "occurrences",
      "fields": {
        "num_bo": "String",
        "ano_bo": "Number",
        "delegacia": "String",
        "category": "String",
        "cluster_count": "Number",
        "server_cluster": "Number"
      }
    }
  ]
}
$tilejson$;
