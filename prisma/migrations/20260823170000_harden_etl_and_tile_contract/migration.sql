CREATE OR REPLACE FUNCTION public.map_features_refresh_date_range_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting(
    'mapa.defer_map_features_date_range_refresh',
    TRUE
  ) = 'on' THEN
    RETURN NULL;
  END IF;

  PERFORM public.refresh_map_features_date_range();
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.map_features_try_iso_date(value TEXT)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  parsed DATE;
BEGIN
  IF value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RETURN NULL;
  END IF;

  BEGIN
    parsed := value::DATE;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
    RETURN NULL;
  END;

  RETURN CASE WHEN to_char(parsed, 'YYYY-MM-DD') = value THEN parsed END;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_map_feature_tile_partitions(
  ahead_years INTEGER DEFAULT 5
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  partition_year INTEGER;
  partition_name TEXT;
  upper_year INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER +
    GREATEST(1, LEAST(ahead_years, 10));
BEGIN
  LOCK TABLE public.map_feature_tile_points IN ACCESS EXCLUSIVE MODE;

  FOR partition_year IN 2031..upper_year LOOP
    partition_name := format('map_feature_tile_points_y%s', partition_year);
    IF to_regclass(format('public.%I', partition_name)) IS NOT NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'CREATE TABLE public.%I (LIKE public.map_feature_tile_points INCLUDING ALL)',
      partition_name
    );
    EXECUTE format(
      'INSERT INTO public.%I SELECT * FROM public.map_feature_tile_points_default
       WHERE data_ocorrencia >= make_date($1, 1, 1)
         AND data_ocorrencia < make_date($1 + 1, 1, 1)',
      partition_name
    ) USING partition_year;
    DELETE FROM public.map_feature_tile_points_default
    WHERE data_ocorrencia >= make_date(partition_year, 1, 1)
      AND data_ocorrencia < make_date(partition_year + 1, 1, 1);
    EXECUTE format(
      'ALTER TABLE public.map_feature_tile_points ATTACH PARTITION public.%I
       FOR VALUES FROM (%L) TO (%L)',
      partition_name,
      make_date(partition_year, 1, 1),
      make_date(partition_year + 1, 1, 1)
    );
  END LOOP;
END;
$$;

SELECT public.ensure_map_feature_tile_partitions(5);

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
  category_filter TEXT[];
  period_filter TEXT[];
  before_date DATE := public.map_features_try_iso_date(query_params->>'before');
  after_date DATE := public.map_features_try_iso_date(query_params->>'after');
  start_hour INTEGER;
  end_hour INTEGER;
  tile_envelope geometry := ST_TileEnvelope(z, x, y);
  grid_size DOUBLE PRECISION;
  cells_per_tile INTEGER;
BEGIN
  IF z < 10 OR z > 22 THEN
    RETURN NULL;
  END IF;

  IF COALESCE(query_params->>'startHour', '') ~ '^([0-9]|1[0-9]|2[0-3])$' THEN
    start_hour := (query_params->>'startHour')::INTEGER;
  END IF;
  IF COALESCE(query_params->>'endHour', '') ~ '^([0-9]|1[0-9]|2[0-3])$' THEN
    end_hour := (query_params->>'endHour')::INTEGER;
  END IF;

  IF json_typeof(query_params->'categories') = 'array' THEN
    SELECT array_agg(value ORDER BY value)
    INTO category_filter
    FROM (
      SELECT DISTINCT NULLIF(btrim(value), '') AS value
      FROM json_array_elements_text(query_params->'categories') AS values(value)
    ) normalized
    WHERE value IS NOT NULL;
  ELSIF json_typeof(query_params->'categories') = 'string' THEN
    SELECT array_agg(value ORDER BY value)
    INTO category_filter
    FROM (
      SELECT DISTINCT NULLIF(btrim(value), '') AS value
      FROM unnest(regexp_split_to_array(query_params->>'categories', '\s*,\s*'))
        AS values(value)
    ) normalized
    WHERE value IS NOT NULL;
  END IF;

  IF json_typeof(query_params->'periods') = 'array' THEN
    SELECT array_agg(value ORDER BY value)
    INTO period_filter
    FROM (
      SELECT DISTINCT public.map_features_normalize_period(value) AS value
      FROM json_array_elements_text(query_params->'periods') AS values(value)
    ) normalized
    WHERE value IS NOT NULL;
  ELSIF json_typeof(query_params->'periods') = 'string' THEN
    SELECT array_agg(value ORDER BY value)
    INTO period_filter
    FROM (
      SELECT DISTINCT public.map_features_normalize_period(value) AS value
      FROM unnest(regexp_split_to_array(query_params->>'periods', '\s*,\s*'))
        AS values(value)
    ) normalized
    WHERE value IS NOT NULL;
  END IF;

  IF z < 16 THEN
    cells_per_tile := CASE z
      WHEN 10 THEN 4 WHEN 11 THEN 5 WHEN 12 THEN 6
      WHEN 13 THEN 8 WHEN 14 THEN 10 ELSE 12
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
              FROM unnest(tile_point.search_categories)
                AS matched_categories(matched_category)
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
            start_hour IS NULL OR end_hour IS NULL
            OR (start_hour <= end_hour AND tile_point.hora_ocorrencia BETWEEN start_hour AND end_hour)
            OR (start_hour > end_hour AND (
              tile_point.hora_ocorrencia >= start_hour
              OR tile_point.hora_ocorrencia <= end_hour
            ))
          )
      ),
      binned AS (
        SELECT *,
          floor(point_x / grid_size) AS cell_x,
          floor(point_y / grid_size) AS cell_y
        FROM filtered
      ),
      clusters AS (
        SELECT
          cell_x,
          cell_y,
          CASE
            WHEN count(DISTINCT category) = 1 THEN min(category)
            ELSE 'Múltiplas categorias'
          END AS category,
          count(*)::INTEGER AS cluster_count,
          CASE WHEN count(*) = 1 THEN min(id::TEXT)::UUID END AS singleton_id,
          CASE WHEN count(*) = 1 THEN min(data_ocorrencia) END AS singleton_date,
          ST_SetSRID(ST_MakePoint(avg(point_x), avg(point_y)), 3857) AS cluster_geom
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
      ORDER BY clusters.cell_x, clusters.cell_y
    ) AS tile_data
    WHERE mvt_geom IS NOT NULL;
  ELSE
    SELECT ST_AsMVT(tile_data, 'occurrences', 4096, 'mvt_geom')
    INTO mvt
    FROM (
      WITH filtered AS (
        SELECT
          tile_point.*,
          count(*) OVER () AS tile_total,
          md5(tile_point.id::TEXT || ':' || COALESCE(tile_point.data_ocorrencia::TEXT, '')) AS stable_order
        FROM map_feature_tile_points tile_point
        WHERE tile_point.geom_3857 && tile_envelope
          AND (before_date IS NULL OR tile_point.data_ocorrencia <= before_date)
          AND (after_date IS NULL OR tile_point.data_ocorrencia >= after_date)
          AND (category_filter IS NULL OR tile_point.search_categories && category_filter)
          AND (period_filter IS NULL OR tile_point.periodo_normalized = ANY(period_filter))
          AND (
            start_hour IS NULL OR end_hour IS NULL
            OR (start_hour <= end_hour AND tile_point.hora_ocorrencia BETWEEN start_hour AND end_hour)
            OR (start_hour > end_hour AND (
              tile_point.hora_ocorrencia >= start_hour
              OR tile_point.hora_ocorrencia <= end_hour
            ))
          )
      ),
      limited AS (
        SELECT * FROM filtered ORDER BY stable_order LIMIT 50000
      )
      SELECT
        num_bo,
        ano_bo,
        delegacia,
        CASE
          WHEN category_filter IS NULL THEN category
          ELSE (
            SELECT min(matched_category)
            FROM unnest(search_categories) AS matched_categories(matched_category)
            WHERE matched_category = ANY(category_filter)
          )
        END AS category,
        tile_total,
        CASE WHEN tile_total > 50000 THEN 1 END AS truncated,
        ST_AsMVTGeom(geom_3857, tile_envelope, 4096, 256, true) AS mvt_geom
      FROM limited
      ORDER BY stable_order
    ) AS tile_data
    WHERE mvt_geom IS NOT NULL;
  END IF;

  RETURN mvt;
END;
$$;
