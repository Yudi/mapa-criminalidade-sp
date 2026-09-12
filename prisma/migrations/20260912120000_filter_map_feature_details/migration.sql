CREATE OR REPLACE FUNCTION public.map_feature_matches_details(data JSONB, filters JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $fn$
  SELECT
    (COALESCE(jsonb_array_length(filters->'vehicleBrands'), 0) = 0 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(data->'records', '[]'::jsonb)) record
      WHERE record->>'type' IN ('veiculo', 'produtividade_veiculos')
        AND filters->'vehicleBrands' ? NULLIF(btrim(record->>'marca'), '')
    ))
    AND (COALESCE(jsonb_array_length(filters->'objectTypes'), 0) = 0 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(data->'records', '[]'::jsonb)) record
      WHERE record->>'type' IN ('objeto', 'celular')
        AND filters->'objectTypes' ? COALESCE(NULLIF(btrim(record->>'descr_tipo_objeto'), ''), NULLIF(btrim(record->>'descr_subtipo_objeto'), ''))
    ))
    AND (COALESCE(jsonb_array_length(filters->'phoneBrandModels'), 0) = 0 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(data->'records', '[]'::jsonb)) record
      WHERE record->>'type' = 'celular'
        AND filters->'phoneBrandModels' ? concat_ws(
          ' · ',
          COALESCE(NULLIF(btrim(record->>'marca'), ''), 'Marca não informada'),
          NULLIF(btrim(record->>'descr_subtipo_objeto'), '')
        )
    ))
    AND (COALESCE(jsonb_array_length(filters->'locationTypes'), 0) = 0
      OR COALESCE(filters->'locationTypes' ? NULLIF(btrim(data->'location'->>'tipo_local'), ''), FALSE));
$fn$;

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
  weekday_filter INTEGER[];
  before_date DATE := public.map_features_try_iso_date(query_params->>'before');
  after_date DATE := public.map_features_try_iso_date(query_params->>'after');
  start_hour INTEGER;
  end_hour INTEGER;
  tile_envelope geometry;
  filter_key TEXT;
  filter_value JSON;
  detail_filters JSONB := '{}'::jsonb;
  grid_size DOUBLE PRECISION;
  cells_per_tile INTEGER;
BEGIN
  IF z IS NULL OR z < 10 OR z > 22 OR x IS NULL OR y IS NULL
     OR x < 0 OR y < 0 OR x >= power(2, z) OR y >= power(2, z) THEN
    RAISE EXCEPTION 'Invalid tile coordinates' USING ERRCODE = '22023';
  END IF;
  tile_envelope := ST_TileEnvelope(z, x, y);
  IF query_params IS NOT NULL AND json_typeof(query_params) <> 'object' THEN
    RAISE EXCEPTION 'Invalid tile filters' USING ERRCODE = '22023';
  END IF;
  FOREACH filter_key IN ARRAY ARRAY['before', 'after'] LOOP
    filter_value := query_params->filter_key;
    IF filter_value IS NOT NULL AND (
      json_typeof(filter_value) <> 'string'
      OR public.map_features_try_iso_date(query_params->>filter_key) IS NULL
    ) THEN
      RAISE EXCEPTION 'Invalid date filter: %', filter_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF before_date < after_date OR before_date - after_date > 10980 THEN
    RAISE EXCEPTION 'Invalid date range' USING ERRCODE = '22023';
  END IF;
  IF (query_params->'startHour' IS NULL) <> (query_params->'endHour' IS NULL) THEN
    RAISE EXCEPTION 'Hour filters must be used together' USING ERRCODE = '22023';
  END IF;
  FOREACH filter_key IN ARRAY ARRAY['startHour', 'endHour'] LOOP
    filter_value := query_params->filter_key;
    IF filter_value IS NOT NULL AND (
      json_typeof(filter_value) NOT IN ('string', 'number')
      OR (query_params->>filter_key) !~ '^([0-9]|1[0-9]|2[0-3])$'
    ) THEN
      RAISE EXCEPTION 'Invalid hour filter: %', filter_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOREACH filter_key IN ARRAY ARRAY['categories', 'periods'] LOOP
    filter_value := query_params->filter_key;
    IF filter_value IS NULL THEN CONTINUE; END IF;
    IF json_typeof(filter_value) = 'array' THEN
      IF json_array_length(filter_value) > 200 OR EXISTS (
        SELECT 1 FROM json_array_elements(filter_value) item
        WHERE json_typeof(item) <> 'string' OR length(item #>> '{}') > 256
          OR (item #>> '{}') ~ '[[:cntrl:]]'
      ) THEN
        RAISE EXCEPTION 'Invalid filter list: %', filter_key USING ERRCODE = '22023';
      END IF;
    ELSIF json_typeof(filter_value) = 'string' THEN
      IF cardinality(string_to_array(query_params->>filter_key, ',')) > 200 OR EXISTS (
        SELECT 1 FROM unnest(string_to_array(query_params->>filter_key, ',')) item
        WHERE length(item) > 256 OR item ~ '[[:cntrl:]]'
      ) THEN
        RAISE EXCEPTION 'Invalid filter list: %', filter_key USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'Invalid filter list: %', filter_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOREACH filter_key IN ARRAY ARRAY['vehicleBrands', 'objectTypes', 'phoneBrandModels', 'locationTypes'] LOOP
    filter_value := query_params->filter_key;
    IF filter_value IS NULL THEN CONTINUE; END IF;
    IF json_typeof(filter_value) = 'string' THEN
      BEGIN
        filter_value := (query_params->>filter_key)::json;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Invalid filter list: %', filter_key USING ERRCODE = '22023';
      END;
    END IF;
    IF json_typeof(filter_value) <> 'array' THEN
      RAISE EXCEPTION 'Invalid filter list: %', filter_key USING ERRCODE = '22023';
    END IF;
    IF json_array_length(filter_value) > 200 OR EXISTS (
      SELECT 1 FROM json_array_elements(filter_value) item
      WHERE json_typeof(item) <> 'string' OR length(item #>> '{}') > 256
        OR (item #>> '{}') ~ '[[:cntrl:]]'
    ) THEN
      RAISE EXCEPTION 'Invalid filter list: %', filter_key USING ERRCODE = '22023';
    END IF;
    detail_filters := detail_filters || jsonb_build_object(filter_key, (
      SELECT COALESCE(jsonb_agg(value ORDER BY value), '[]'::jsonb)
      FROM (SELECT DISTINCT btrim(value) AS value FROM json_array_elements_text(filter_value)) normalized
      WHERE value <> ''
    ));
  END LOOP;

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

  filter_value := query_params->'weekdays';
  IF filter_value IS NOT NULL THEN
    IF json_typeof(filter_value) = 'string' THEN
      BEGIN
        filter_value := (query_params->>'weekdays')::json;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Invalid filter list: weekdays' USING ERRCODE = '22023';
      END;
    END IF;
    IF json_typeof(filter_value) <> 'array'
      OR json_array_length(filter_value) > 7
      OR EXISTS (
        SELECT 1 FROM json_array_elements(filter_value) item
        WHERE json_typeof(item) <> 'number'
          OR (item #>> '{}') !~ '^[1-7]$'
      ) THEN
      RAISE EXCEPTION 'Invalid filter list: weekdays' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(value ORDER BY value)
    INTO weekday_filter
    FROM (
      SELECT DISTINCT (item #>> '{}')::INTEGER AS value
      FROM json_array_elements(filter_value) item
    ) normalized;
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
          AND (weekday_filter IS NULL OR EXTRACT(ISODOW FROM tile_point.data_ocorrencia)::INTEGER = ANY(weekday_filter))
          AND (NOT EXISTS (
            SELECT 1 FROM jsonb_each(detail_filters) dimension WHERE jsonb_array_length(dimension.value) > 0
          ) OR EXISTS (
            SELECT 1 FROM map_features detail
            WHERE detail.id = tile_point.id
              AND public.map_feature_matches_details(detail.feature_data, detail_filters)
          ))
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
        singleton.id::TEXT AS feature_id,
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
          AND (weekday_filter IS NULL OR EXTRACT(ISODOW FROM tile_point.data_ocorrencia)::INTEGER = ANY(weekday_filter))
          AND (NOT EXISTS (
            SELECT 1 FROM jsonb_each(detail_filters) dimension WHERE jsonb_array_length(dimension.value) > 0
          ) OR EXISTS (
            SELECT 1 FROM map_features detail
            WHERE detail.id = tile_point.id
              AND public.map_feature_matches_details(detail.feature_data, detail_filters)
          ))
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
        id::TEXT AS feature_id,
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
