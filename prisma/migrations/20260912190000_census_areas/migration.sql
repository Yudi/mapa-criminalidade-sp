CREATE TABLE census_releases (
  id text PRIMARY KEY,
  year integer NOT NULL CHECK (year BETWEEN 2022 AND 2200),
  state_code text NOT NULL CHECK (state_code = '35'),
  active boolean NOT NULL DEFAULT false,
  manifest jsonb NOT NULL,
  imported_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX census_one_active_release ON census_releases (active) WHERE active;
CREATE TABLE census_areas (
  release_id text NOT NULL REFERENCES census_releases(id),
  level text NOT NULL CHECK (level IN ('municipality', 'neighborhood')),
  code text NOT NULL,
  name text NOT NULL,
  municipality_code text NOT NULL CHECK (municipality_code ~ '^35[0-9]{5}$'),
  municipality_name text NOT NULL,
  population integer CHECK (population >= 0),
  indicators jsonb NOT NULL CHECK (jsonb_typeof(indicators) = 'array'),
  geom geometry(MultiPolygon,4326) NOT NULL,
  geom_web geometry(MultiPolygon,3857) NOT NULL,
  label_point geometry(Point,3857) NOT NULL,
  area_km2 double precision NOT NULL CHECK (area_km2 > 0),
  PRIMARY KEY (release_id, level, code),
  CHECK ((level = 'municipality' AND code = municipality_code)
    OR (level = 'neighborhood' AND code ~ '^35[0-9]{8}$' AND left(code, 7) = municipality_code)),
  CHECK (ST_IsValid(geom) AND NOT ST_IsEmpty(geom))
);
CREATE INDEX census_areas_geom_idx ON census_areas USING gist (geom);
CREATE INDEX census_areas_geom_web_idx ON census_areas USING gist (geom_web);
CREATE INDEX census_areas_municipality_idx ON census_areas (release_id, level, municipality_code);

-- Shared by Martin and the API fallback. The immutable release is required in
-- the URL query, so replacing the active release cannot reuse an old tile key.
CREATE FUNCTION public.census_areas_tile(z integer, x integer, y integer, query_params json)
RETURNS bytea LANGUAGE plpgsql STABLE PARALLEL SAFE AS $$
DECLARE
  release_key text := query_params->>'release';
  area_level text := query_params->>'level';
  result bytea;
BEGIN
  IF z IS NULL OR x IS NULL OR y IS NULL OR z < 0 OR z > 19 OR
    x < 0 OR y < 0 OR x >= (1::bigint << z) OR y >= (1::bigint << z) THEN
    RAISE EXCEPTION 'Invalid census tile coordinates' USING ERRCODE = '22023';
  END IF;
  IF release_key IS NULL OR release_key !~ '^[a-z0-9][a-z0-9-]{0,79}$' OR
    area_level IS NULL OR area_level NOT IN ('municipality','neighborhood') THEN
    RAISE EXCEPTION 'A census release and geographic level are required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.census_releases WHERE id=release_key) THEN
    RAISE EXCEPTION 'Unknown census release' USING ERRCODE = '22023';
  END IF;
  IF z < (CASE WHEN area_level = 'municipality' THEN 6 ELSE 11 END) THEN
    RETURN ''::bytea;
  END IF;
  WITH bounds AS (SELECT ST_TileEnvelope(z,x,y) AS envelope),
  visible AS MATERIALIZED (
    SELECT code,name,geom_web,label_point FROM public.census_areas,bounds
    WHERE release_id=release_key AND level=area_level
      AND geom_web && ST_Expand(envelope,(ST_XMax(envelope)-ST_XMin(envelope))/16)
  ), polygons AS (
    SELECT code,name,ST_AsMVTGeom(
      ST_SimplifyPreserveTopology(geom_web,(ST_XMax(envelope)-ST_XMin(envelope))/4096),
      envelope,4096,256,true) AS geom FROM visible,bounds
  ), labels AS (
    SELECT code,name,ST_AsMVTGeom(label_point,envelope,4096,0,true) AS geom
    FROM visible,bounds WHERE ST_Covers(envelope,label_point)
  )
  SELECT (SELECT ST_AsMVT(polygons,'areas',4096,'geom') FROM polygons WHERE geom IS NOT NULL)
    || (SELECT ST_AsMVT(labels,'labels',4096,'geom') FROM labels WHERE geom IS NOT NULL)
  INTO result;
  RETURN COALESCE(result,''::bytea);
END;
$$;
COMMENT ON FUNCTION public.census_areas_tile(integer,integer,integer,json) IS
'IBGE census polygons and label points for SP. Required query parameters: release (immutable release ID), level (municipality or neighborhood). No crime precomputation.';
