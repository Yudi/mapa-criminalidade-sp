CREATE INDEX IF NOT EXISTS idx_map_features_modern_bo_unit
ON public.map_features (
  (substring(upper(btrim("num_bo")) from '^([A-Z]{2}[0-9]{4})(-[1-9][0-9]*)?$')),
  ano_bo,
  delegacia
)
WHERE substring(upper(btrim("num_bo")) from '^([A-Z]{2}[0-9]{4})(-[1-9][0-9]*)?$') IS NOT NULL;

DO $migration$
DECLARE
  iml_table text;
BEGIN
  FOR iml_table IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'raw'
      AND table_type = 'BASE TABLE'
      AND table_name ~ '^registro_obitos_iml_[0-9]{4}$'
  LOOP
    EXECUTE format($index$
      CREATE INDEX IF NOT EXISTS %I ON raw.%I (
        (substring(upper(btrim("NUM_BO")) from '^([A-Z]{2}[0-9]{4})(-[1-9][0-9]*)?$')),
        "ANO_BO",
        "DELEGACIA_REGISTRO_NORMALIZED"
      )
      WHERE "NUM_BO_NORMALIZED" <> ''
        AND "ANO_BO" <> ''
        AND "DELEGACIA_REGISTRO_NORMALIZED" <> ''
        AND substring(upper(btrim("NUM_BO")) from '^([A-Z]{2}[0-9]{4})(-[1-9][0-9]*)?$') IS NOT NULL
    $index$, 'idx_' || iml_table || '_modern_bo_lookup', iml_table);
  END LOOP;
END;
$migration$;
