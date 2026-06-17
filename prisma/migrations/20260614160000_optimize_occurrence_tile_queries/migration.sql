CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS "map_feature_tile_points" (
  "id" UUID NOT NULL,
  "num_bo" TEXT NOT NULL,
  "ano_bo" INTEGER NOT NULL,
  "delegacia" TEXT,
  "geom_3857" geometry(Point, 3857) NOT NULL,
  "point_x" DOUBLE PRECISION NOT NULL,
  "point_y" DOUBLE PRECISION NOT NULL,
  "category" TEXT NOT NULL,
  "data_ocorrencia" DATE,
  "periodo_normalized" TEXT,
  "hora_ocorrencia" INTEGER,
  "search_categories" TEXT[] NOT NULL,
  UNIQUE NULLS NOT DISTINCT ("id", "data_ocorrencia")
) PARTITION BY RANGE ("data_ocorrencia");

DO $$
DECLARE
  partition_year INTEGER;
BEGIN
  FOR partition_year IN 2013..2030 LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS map_feature_tile_points_y%s
       PARTITION OF map_feature_tile_points
       FOR VALUES FROM (%L) TO (%L)',
      partition_year,
      make_date(partition_year, 1, 1),
      make_date(partition_year + 1, 1, 1)
    );
  END LOOP;
END;
$$;

CREATE TABLE IF NOT EXISTS "map_feature_tile_points_default"
PARTITION OF "map_feature_tile_points" DEFAULT;

ALTER TABLE "map_feature_tile_points"
ALTER COLUMN "data_ocorrencia" SET STATISTICS 500,
ALTER COLUMN "search_categories" SET STATISTICS 500;

DO $$
DECLARE
  partition_name TEXT;
BEGIN
  FOR partition_name IN
    SELECT inhrelid::regclass::TEXT
    FROM pg_inherits
    WHERE inhparent = 'map_feature_tile_points'::regclass
  LOOP
    EXECUTE format(
      'ALTER TABLE %s SET (
        autovacuum_analyze_scale_factor = 0.005,
        autovacuum_analyze_threshold = 2500,
        autovacuum_vacuum_scale_factor = 0.02,
        autovacuum_vacuum_threshold = 5000,
        autovacuum_vacuum_cost_delay = 2
      )',
      partition_name
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.map_features_sync_tile_point()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.map_feature_tile_points
    WHERE id = OLD.id
      AND data_ocorrencia IS NOT DISTINCT FROM OLD.data_ocorrencia;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    DELETE FROM public.map_feature_tile_points
    WHERE id = OLD.id
      AND data_ocorrencia IS NOT DISTINCT FROM OLD.data_ocorrencia;
  END IF;

  IF NEW.geom_3857 IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.map_feature_tile_points (
    id,
    num_bo,
    ano_bo,
    delegacia,
    geom_3857,
    point_x,
    point_y,
    category,
    data_ocorrencia,
    periodo_normalized,
    hora_ocorrencia,
    search_categories
  )
  VALUES (
    NEW.id,
    NEW.num_bo,
    NEW.ano_bo,
    NEW.delegacia,
    NEW.geom_3857,
    ST_X(NEW.geom_3857),
    ST_Y(NEW.geom_3857),
    NEW.category,
    NEW.data_ocorrencia,
    NEW.periodo_normalized,
    NEW.hora_ocorrencia,
    NEW.search_categories
  )
  ON CONFLICT (id, data_ocorrencia) DO UPDATE SET
    num_bo = EXCLUDED.num_bo,
    ano_bo = EXCLUDED.ano_bo,
    delegacia = EXCLUDED.delegacia,
    geom_3857 = EXCLUDED.geom_3857,
    point_x = EXCLUDED.point_x,
    point_y = EXCLUDED.point_y,
    category = EXCLUDED.category,
    periodo_normalized = EXCLUDED.periodo_normalized,
    hora_ocorrencia = EXCLUDED.hora_ocorrencia,
    search_categories = EXCLUDED.search_categories;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_map_features_sync_tile_point_upsert"
ON "map_features";
DROP TRIGGER IF EXISTS "trg_map_features_sync_tile_point_insert"
ON "map_features";
CREATE TRIGGER "trg_map_features_sync_tile_point_insert"
AFTER INSERT
ON "map_features"
FOR EACH ROW
EXECUTE FUNCTION public.map_features_sync_tile_point();

DROP TRIGGER IF EXISTS "trg_map_features_sync_tile_point_update"
ON "map_features";
CREATE TRIGGER "trg_map_features_sync_tile_point_update"
AFTER UPDATE
ON "map_features"
FOR EACH ROW
WHEN (
  OLD.num_bo IS DISTINCT FROM NEW.num_bo
  OR OLD.ano_bo IS DISTINCT FROM NEW.ano_bo
  OR OLD.delegacia IS DISTINCT FROM NEW.delegacia
  OR OLD.geom IS DISTINCT FROM NEW.geom
  OR OLD.category IS DISTINCT FROM NEW.category
  OR OLD.data_ocorrencia IS DISTINCT FROM NEW.data_ocorrencia
  OR OLD.periodo_normalized IS DISTINCT FROM NEW.periodo_normalized
  OR OLD.hora_ocorrencia IS DISTINCT FROM NEW.hora_ocorrencia
  OR OLD.search_categories IS DISTINCT FROM NEW.search_categories
)
EXECUTE FUNCTION public.map_features_sync_tile_point();

DROP TRIGGER IF EXISTS "trg_map_features_sync_tile_point_delete"
ON "map_features";
CREATE TRIGGER "trg_map_features_sync_tile_point_delete"
AFTER DELETE
ON "map_features"
FOR EACH ROW
EXECUTE FUNCTION public.map_features_sync_tile_point();

INSERT INTO public.map_feature_tile_points (
  id,
  num_bo,
  ano_bo,
  delegacia,
  geom_3857,
  point_x,
  point_y,
  category,
  data_ocorrencia,
  periodo_normalized,
  hora_ocorrencia,
  search_categories
)
SELECT
  id,
  num_bo,
  ano_bo,
  delegacia,
  geom_3857,
  ST_X(geom_3857),
  ST_Y(geom_3857),
  category,
  data_ocorrencia,
  periodo_normalized,
  hora_ocorrencia,
  search_categories
FROM map_features
WHERE geom_3857 IS NOT NULL
ON CONFLICT ("id", "data_ocorrencia") DO NOTHING;

CREATE INDEX IF NOT EXISTS "idx_map_feature_tile_points_geom_date"
ON "map_feature_tile_points" USING GIST ("geom_3857", "data_ocorrencia");

CREATE INDEX IF NOT EXISTS "idx_map_feature_tile_points_categories_gin"
ON "map_feature_tile_points" USING GIN ("search_categories");

CREATE INDEX IF NOT EXISTS "idx_map_feature_tile_points_date_period"
ON "map_feature_tile_points" ("data_ocorrencia", "periodo_normalized");

CREATE INDEX IF NOT EXISTS "idx_map_feature_tile_points_date_hour"
ON "map_feature_tile_points" ("data_ocorrencia", "hora_ocorrencia");

DROP INDEX IF EXISTS "idx_map_features_geom_3857";

ANALYZE "map_feature_tile_points";

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
          tile_point.id,
          tile_point.data_ocorrencia,
          CASE
            WHEN category_filter IS NULL THEN tile_point.category
            ELSE (
              SELECT min(matched_category)
              FROM unnest(tile_point.search_categories) AS matched_categories(matched_category)
              WHERE matched_category = ANY(category_filter)
            )
          END AS category,
          tile_point.point_x,
          tile_point.point_y
        FROM map_feature_tile_points tile_point
        WHERE tile_point.geom_3857 && tile_envelope
          AND (before_date IS NULL OR tile_point.data_ocorrencia <= before_date)
          AND (after_date IS NULL OR tile_point.data_ocorrencia >= after_date)
          AND (category_filter IS NULL OR tile_point.search_categories && category_filter)
          AND (period_filter IS NULL OR tile_point.periodo_normalized = ANY(period_filter))
          AND (
            start_hour IS NULL
            OR end_hour IS NULL
            OR (
              start_hour <= end_hour
              AND tile_point.hora_ocorrencia BETWEEN start_hour AND end_hour
            )
            OR (
              start_hour > end_hour
              AND (
                tile_point.hora_ocorrencia >= start_hour
                OR tile_point.hora_ocorrencia <= end_hour
              )
            )
          )
      ),
      binned AS (
        SELECT
          id,
          data_ocorrencia,
          category,
          point_x,
          point_y,
          floor(point_x / grid_size) AS cell_x,
          floor(point_y / grid_size) AS cell_y
        FROM filtered
      ),
      clusters AS (
        SELECT
          min(category) AS category,
          count(*)::INTEGER AS cluster_count,
          CASE WHEN count(*) = 1 THEN min(id::TEXT)::UUID END AS singleton_id,
          CASE WHEN count(*) = 1 THEN min(data_ocorrencia) END AS singleton_date,
          ST_SetSRID(
            ST_MakePoint(avg(point_x), avg(point_y)),
            3857
          ) AS cluster_geom
        FROM binned
        GROUP BY cell_x, cell_y
      )
      SELECT
        singleton.num_bo,
        singleton.ano_bo,
        singleton.delegacia,
        clusters.category,
        CASE WHEN clusters.cluster_count > 1 THEN clusters.cluster_count END AS cluster_count,
        CASE WHEN clusters.cluster_count > 1 THEN 1 END AS server_cluster,
        CASE WHEN clusters.cluster_count = 1 THEN 1 END AS server_singleton,
        ST_AsMVTGeom(clusters.cluster_geom, tile_envelope, 4096, 64, true) AS mvt_geom
      FROM clusters
      LEFT JOIN map_feature_tile_points singleton
        ON singleton.id = clusters.singleton_id
        AND singleton.data_ocorrencia IS NOT DISTINCT FROM clusters.singleton_date
    ) AS tile_data
    WHERE mvt_geom IS NOT NULL;
  ELSE
    SELECT ST_AsMVT(tile_data, 'occurrences', 4096, 'mvt_geom')
    INTO mvt
    FROM (
      SELECT
        tile_point.num_bo,
        tile_point.ano_bo,
        tile_point.delegacia,
        CASE
          WHEN category_filter IS NULL THEN tile_point.category
          ELSE (
            SELECT min(matched_category)
            FROM unnest(tile_point.search_categories) AS matched_categories(matched_category)
            WHERE matched_category = ANY(category_filter)
          )
        END AS category,
        ST_AsMVTGeom(tile_point.geom_3857, tile_envelope, 4096, 256, true) AS mvt_geom
      FROM map_feature_tile_points tile_point
      WHERE tile_point.geom_3857 && tile_envelope
        AND (before_date IS NULL OR tile_point.data_ocorrencia <= before_date)
        AND (after_date IS NULL OR tile_point.data_ocorrencia >= after_date)
        AND (category_filter IS NULL OR tile_point.search_categories && category_filter)
        AND (period_filter IS NULL OR tile_point.periodo_normalized = ANY(period_filter))
        AND (
          start_hour IS NULL
          OR end_hour IS NULL
          OR (
            start_hour <= end_hour
            AND tile_point.hora_ocorrencia BETWEEN start_hour AND end_hour
          )
          OR (
            start_hour > end_hour
            AND (
              tile_point.hora_ocorrencia >= start_hour
              OR tile_point.hora_ocorrencia <= end_hour
            )
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
        "server_cluster": "Number",
        "server_singleton": "Number"
      }
    }
  ]
}
$tilejson$;
