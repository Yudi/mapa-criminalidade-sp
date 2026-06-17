CREATE TABLE "map_features_date_range" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "earliest_date" DATE,
  "latest_date" DATE,
  "default_after_date" DATE,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "map_features_date_range_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "map_features_date_range_singleton_check" CHECK ("id" = 1)
);

CREATE OR REPLACE FUNCTION public.refresh_map_features_date_range()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('map_features_date_range', 0)
  );

  WITH date_bounds AS (
    SELECT
      MIN(data_ocorrencia) AS earliest_date,
      MAX(data_ocorrencia) AS latest_date
    FROM public.map_features
    WHERE data_ocorrencia >= DATE '2013-01-01'
  )
  INSERT INTO public.map_features_date_range (
    id,
    earliest_date,
    latest_date,
    default_after_date,
    updated_at
  )
  SELECT
    1,
    earliest_date,
    latest_date,
    GREATEST(earliest_date, (latest_date - INTERVAL '3 months')::DATE),
    CURRENT_TIMESTAMP
  FROM date_bounds
  ON CONFLICT (id) DO UPDATE SET
    earliest_date = EXCLUDED.earliest_date,
    latest_date = EXCLUDED.latest_date,
    default_after_date = EXCLUDED.default_after_date,
    updated_at = EXCLUDED.updated_at
  WHERE public.map_features_date_range.earliest_date
          IS DISTINCT FROM EXCLUDED.earliest_date
     OR public.map_features_date_range.latest_date
          IS DISTINCT FROM EXCLUDED.latest_date
     OR public.map_features_date_range.default_after_date
          IS DISTINCT FROM EXCLUDED.default_after_date;
END;
$$;

CREATE OR REPLACE FUNCTION public.map_features_refresh_date_range_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.refresh_map_features_date_range();
  RETURN NULL;
END;
$$;

SELECT public.refresh_map_features_date_range();

CREATE TRIGGER "trg_map_features_refresh_date_range_insert"
AFTER INSERT ON public.map_features
FOR EACH STATEMENT
EXECUTE FUNCTION public.map_features_refresh_date_range_trigger();

CREATE TRIGGER "trg_map_features_refresh_date_range_update"
AFTER UPDATE OF data_ocorrencia ON public.map_features
FOR EACH STATEMENT
EXECUTE FUNCTION public.map_features_refresh_date_range_trigger();

CREATE TRIGGER "trg_map_features_refresh_date_range_delete"
AFTER DELETE ON public.map_features
FOR EACH STATEMENT
EXECUTE FUNCTION public.map_features_refresh_date_range_trigger();

CREATE TRIGGER "trg_map_features_refresh_date_range_truncate"
AFTER TRUNCATE ON public.map_features
FOR EACH STATEMENT
EXECUTE FUNCTION public.map_features_refresh_date_range_trigger();
