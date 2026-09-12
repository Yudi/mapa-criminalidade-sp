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
          ' - ',
          COALESCE(NULLIF(btrim(record->>'marca'), ''), 'Marca não informada'),
          NULLIF(btrim(record->>'descr_subtipo_objeto'), '')
        )
    ))
    AND (COALESCE(jsonb_array_length(filters->'locationTypes'), 0) = 0
      OR COALESCE(filters->'locationTypes' ? NULLIF(btrim(data->'location'->>'tipo_local'), ''), FALSE));
$fn$;
