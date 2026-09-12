ALTER TABLE public.map_feature_tile_points
ADD COLUMN IF NOT EXISTS rubrica_for_styling TEXT NOT NULL DEFAULT 'default';

UPDATE public.map_feature_tile_points AS tile_point
SET rubrica_for_styling = map_feature.rubrica_for_styling
FROM public.map_features AS map_feature
WHERE map_feature.id = tile_point.id;

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
    rubrica_for_styling,
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
    NEW.rubrica_for_styling,
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
    rubrica_for_styling = EXCLUDED.rubrica_for_styling,
    periodo_normalized = EXCLUDED.periodo_normalized,
    hora_ocorrencia = EXCLUDED.hora_ocorrencia,
    search_categories = EXCLUDED.search_categories;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_map_features_sync_tile_point_update ON public.map_features;
CREATE TRIGGER trg_map_features_sync_tile_point_update
AFTER UPDATE
ON public.map_features
FOR EACH ROW
WHEN (
  OLD.num_bo IS DISTINCT FROM NEW.num_bo
  OR OLD.ano_bo IS DISTINCT FROM NEW.ano_bo
  OR OLD.delegacia IS DISTINCT FROM NEW.delegacia
  OR OLD.geom IS DISTINCT FROM NEW.geom
  OR OLD.category IS DISTINCT FROM NEW.category
  OR OLD.rubrica_for_styling IS DISTINCT FROM NEW.rubrica_for_styling
  OR OLD.data_ocorrencia IS DISTINCT FROM NEW.data_ocorrencia
  OR OLD.periodo_normalized IS DISTINCT FROM NEW.periodo_normalized
  OR OLD.hora_ocorrencia IS DISTINCT FROM NEW.hora_ocorrencia
  OR OLD.search_categories IS DISTINCT FROM NEW.search_categories
)
EXECUTE FUNCTION public.map_features_sync_tile_point();
