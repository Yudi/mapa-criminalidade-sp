-- Source snapshots make reconciliation independent of refresh order. Older
-- features become fully attributable as each source is reprocessed by ETL.
CREATE OR REPLACE FUNCTION public.map_features_merge_source_data(
  existing JSONB, incoming JSONB, removed_source TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  WITH metadata AS (
    SELECT (COALESCE(existing->'_source_metadata', '{}'::jsonb) ||
      COALESCE(incoming->'_source_metadata', '{}'::jsonb)) -
      COALESCE(removed_source, '') AS sources
  ), records AS (
    SELECT COALESCE(jsonb_agg(value ORDER BY value->>'source_table', value->>'source_id'), '[]'::jsonb) AS items
    FROM (
      SELECT value FROM jsonb_array_elements(COALESCE(existing->'records', '[]'::jsonb))
      WHERE (removed_source IS NULL OR value->>'source_table' <> removed_source)
        AND NOT (COALESCE(incoming->'_source_metadata', '{}'::jsonb) ? (value->>'source_table'))
      UNION ALL
      SELECT value FROM jsonb_array_elements(COALESCE(incoming->'records', '[]'::jsonb))
    ) record_rows
  ), completeness AS (
    SELECT NOT EXISTS (
      SELECT 1 FROM records, jsonb_array_elements(items) record
      WHERE NOT ((SELECT sources FROM metadata) ? (record->>'source_table'))
    ) AS complete
  ), location_fields AS (
    SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) AS fields
    FROM (
      SELECT DISTINCT ON (field.key) field.key, field.value
      FROM metadata, jsonb_each(sources) source,
        jsonb_each(COALESCE(source.value->'location', '{}'::jsonb)) field
      WHERE field.value NOT IN ('null'::jsonb, '""'::jsonb)
      ORDER BY field.key, field.value::text COLLATE "C"
    ) selected
  ), occurrence_fields AS (
    SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) AS fields
    FROM (
      SELECT DISTINCT ON (field.key) field.key, field.value
      FROM metadata, jsonb_each(sources) source,
        jsonb_each(COALESCE(source.value->'occurrence', '{}'::jsonb)) field
      WHERE field.value NOT IN ('null'::jsonb, '""'::jsonb)
      ORDER BY field.key, field.value::text COLLATE "C"
    ) selected
  ), rubricas AS (
    SELECT COALESCE(jsonb_agg(value ORDER BY value), '[]'::jsonb) AS items
    FROM (
      SELECT DISTINCT to_jsonb(record->>'rubrica') AS value
      FROM records, jsonb_array_elements(items) record
      WHERE NULLIF(record->>'rubrica', '') IS NOT NULL
      UNION
      SELECT DISTINCT rubrica.value
      FROM metadata, jsonb_each(sources) source,
        jsonb_array_elements(COALESCE(source.value->'all_rubricas', '[]'::jsonb)) rubrica(value)
    ) rubrica_values
  ), canonical AS (
    SELECT jsonb_build_object(
      'category', min((source.value->>'category') COLLATE "C"),
      'rubrica_for_styling', (
        SELECT chosen.value->>'rubrica_for_styling'
        FROM metadata, jsonb_each(sources) chosen
        ORDER BY (chosen.value->>'category') COLLATE "C", chosen.key COLLATE "C"
        LIMIT 1
      ),
      'data_ocorrencia', min(source.value->>'data_ocorrencia')
    ) AS fields
    FROM metadata, jsonb_each(sources) source
  )
  SELECT jsonb_build_object(
    '_source_metadata', metadata.sources,
    '_canonical', CASE WHEN completeness.complete THEN canonical.fields ELSE NULL END,
    'location', CASE WHEN completeness.complete THEN location_fields.fields ELSE
      COALESCE(existing->'location', '{}'::jsonb) || COALESCE(incoming->'location', '{}'::jsonb) END,
    'occurrence', CASE WHEN completeness.complete THEN occurrence_fields.fields ELSE
      COALESCE(existing->'occurrence', '{}'::jsonb) || COALESCE(incoming->'occurrence', '{}'::jsonb) END,
    'all_rubricas', rubricas.items,
    'records', records.items,
    'summary', jsonb_build_object(
      'total_records', jsonb_array_length(records.items),
      'celulares_count', (SELECT count(*) FROM jsonb_array_elements(records.items) r WHERE r->>'type' = 'celular'),
      'veiculos_count', (SELECT count(*) FROM jsonb_array_elements(records.items) r WHERE r->>'type' = 'veiculo'),
      'objetos_count', (SELECT count(*) FROM jsonb_array_elements(records.items) r WHERE r->>'type' = 'objeto'),
      'dados_criminais_count', (SELECT count(*) FROM jsonb_array_elements(records.items) r WHERE r->>'type' = 'dados_criminais'),
      'produtividade_count', (SELECT count(*) FROM jsonb_array_elements(records.items) r WHERE r->>'type' LIKE 'produtividade_%')
    )
  ) FROM metadata, records, completeness, location_fields, occurrence_fields, rubricas, canonical;
$$;

CREATE OR REPLACE FUNCTION public.map_features_sync_canonical_fields()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE canonical JSONB := NEW.feature_data->'_canonical';
BEGIN
  IF jsonb_typeof(canonical) = 'object' THEN
    NEW.category := COALESCE(canonical->>'category', 'Outros');
    NEW.rubrica_for_styling := COALESCE(canonical->>'rubrica_for_styling', 'default');
    NEW.data_ocorrencia := (canonical->>'data_ocorrencia')::date;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_map_features_canonical_fields
BEFORE INSERT OR UPDATE OF feature_data ON public.map_features
FOR EACH ROW EXECUTE FUNCTION public.map_features_sync_canonical_fields();
