-- Restore the PostGIS index that Prisma cannot represent for Unsupported geometry.
CREATE INDEX IF NOT EXISTS "idx_map_features_geom"
ON "map_features" USING GIST ("geom");

ALTER TABLE "map_features"
ADD COLUMN IF NOT EXISTS "periodo_normalized" TEXT,
ADD COLUMN IF NOT EXISTS "hora_ocorrencia" INTEGER,
ADD COLUMN IF NOT EXISTS "all_rubricas" TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS "total_records" INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.map_features_normalize_period(period_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT translate(
    lower(regexp_replace(NULLIF(btrim(period_value), ''), '[[:space:]]+', ' ', 'g')),
    'áàâãäéèêëíìîïóòôõöúùûüç',
    'aaaaaeeeeiiiiooooouuuuc'
  );
$$;

CREATE OR REPLACE FUNCTION public.map_features_occurrence_hour(hour_value TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN hour_value ~ '^[[:space:]]*([01]?[0-9]|2[0-3])(:|$|[^0-9])'
    THEN substring(hour_value from '^[[:space:]]*([01]?[0-9]|2[0-3])')::INTEGER
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.map_features_sync_search_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  rubricas TEXT[];
  records_json JSONB;
BEGIN
  SELECT COALESCE(array_agg(rubrica ORDER BY rubrica), ARRAY[]::TEXT[])
  INTO rubricas
  FROM (
    SELECT DISTINCT NULLIF(btrim(value), '') AS rubrica
    FROM jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(COALESCE(NEW.feature_data->'all_rubricas', '[]'::jsonb)) = 'array'
        THEN COALESCE(NEW.feature_data->'all_rubricas', '[]'::jsonb)
        ELSE '[]'::jsonb
      END
    ) AS rubrica_values(value)
  ) AS normalized_rubricas
  WHERE rubrica IS NOT NULL;

  records_json := CASE
    WHEN jsonb_typeof(COALESCE(NEW.feature_data->'records', '[]'::jsonb)) = 'array'
    THEN COALESCE(NEW.feature_data->'records', '[]'::jsonb)
    ELSE '[]'::jsonb
  END;

  NEW.periodo_normalized := public.map_features_normalize_period(
    NEW.feature_data->'occurrence'->>'periodo'
  );
  NEW.hora_ocorrencia := public.map_features_occurrence_hour(
    NEW.feature_data->'occurrence'->>'hora_ocorrencia'
  );
  NEW.all_rubricas := rubricas;
  NEW.total_records := CASE
    WHEN COALESCE(NEW.feature_data->'summary'->>'total_records', '') ~ '^[0-9]+$'
    THEN (NEW.feature_data->'summary'->>'total_records')::INTEGER
    ELSE jsonb_array_length(records_json)
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_map_features_sync_search_columns" ON "map_features";
CREATE TRIGGER "trg_map_features_sync_search_columns"
BEFORE INSERT OR UPDATE OF "feature_data"
ON "map_features"
FOR EACH ROW
EXECUTE FUNCTION public.map_features_sync_search_columns();

UPDATE "map_features"
SET "feature_data" = "feature_data";

CREATE INDEX IF NOT EXISTS "idx_map_features_geom_geography"
ON "map_features" USING GIST (("geom"::geography));

CREATE INDEX IF NOT EXISTS "idx_map_features_all_rubricas_gin"
ON "map_features" USING GIN ("all_rubricas");

CREATE INDEX IF NOT EXISTS "idx_map_features_feature_data_all_rubricas_gin"
ON "map_features" USING GIN (("feature_data"->'all_rubricas'));

CREATE INDEX IF NOT EXISTS "idx_map_features_period"
ON "map_features" ("periodo_normalized");

CREATE INDEX IF NOT EXISTS "idx_map_features_hour"
ON "map_features" ("hora_ocorrencia");

CREATE INDEX IF NOT EXISTS "idx_map_features_date_period"
ON "map_features" ("data_ocorrencia", "periodo_normalized");

CREATE INDEX IF NOT EXISTS "idx_map_features_date_hour"
ON "map_features" ("data_ocorrencia", "hora_ocorrencia");

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
  tile_envelope_4326 geometry := ST_Transform(ST_TileEnvelope(z, x, y), 4326);
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
    SELECT array_agg(category)
    INTO category_filter
    FROM (
      SELECT DISTINCT NULLIF(btrim(value), '') AS category
      FROM unnest(regexp_split_to_array(raw_categories, '\s*,\s*')) AS category_values(value)
    ) AS normalized_categories
    WHERE category IS NOT NULL;
  END IF;

  IF raw_periods IS NOT NULL THEN
    SELECT array_agg(period)
    INTO period_filter
    FROM (
      SELECT DISTINCT public.map_features_normalize_period(value) AS period
      FROM unnest(regexp_split_to_array(raw_periods, '\s*,\s*')) AS period_values(value)
    ) AS normalized_periods
    WHERE period IS NOT NULL;
  END IF;

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
            SELECT rubrica
            FROM unnest(mf.all_rubricas) AS rubrica
            WHERE rubrica = ANY(category_filter)
            ORDER BY rubrica
            LIMIT 1
          ),
          mf.category
        )
      END AS category,
      CASE
        WHEN category_filter IS NULL THEN mf.rubrica_for_styling
        ELSE COALESCE(
          (
            SELECT rubrica
            FROM unnest(mf.all_rubricas) AS rubrica
            WHERE rubrica = ANY(category_filter)
            ORDER BY rubrica
            LIMIT 1
          ),
          mf.rubrica_for_styling
        )
      END AS rubrica_for_styling,
      mf.source_tables[1] AS source_table,
      mf.total_records AS record_count,
      ST_AsMVTGeom(
        ST_Transform(mf.geom, 3857),
        tile_envelope,
        4096,
        256,
        true
      ) AS mvt_geom
    FROM map_features mf
    WHERE mf.geom IS NOT NULL
      AND mf.geom && tile_envelope_4326
      AND ST_Intersects(mf.geom, tile_envelope_4326)
      AND (before_date IS NULL OR mf.data_ocorrencia <= before_date)
      AND (after_date IS NULL OR mf.data_ocorrencia >= after_date)
      AND (
        category_filter IS NULL
        OR mf.category = ANY(category_filter)
        OR mf.all_rubricas && category_filter
      )
      AND (
        period_filter IS NULL
        OR mf.periodo_normalized = ANY(period_filter)
      )
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
    LIMIT 100000000
  ) AS tile_data
  WHERE mvt_geom IS NOT NULL;

  RETURN mvt;
END;
$$;

COMMENT ON FUNCTION public.occurrences(INTEGER, INTEGER, INTEGER, JSON) IS $tilejson$
{
  "description": "Filtered occurrence vector tiles for Mapa Criminalidade",
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
        "rubrica_for_styling": "String",
        "source_table": "String",
        "record_count": "Number"
      }
    }
  ]
}
$tilejson$;
