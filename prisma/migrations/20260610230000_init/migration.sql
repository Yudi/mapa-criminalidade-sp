CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS raw;

CREATE TABLE IF NOT EXISTS file_metadata (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  year INTEGER NOT NULL,
  file_url TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  file_size BIGINT,
  last_downloaded TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_imported TIMESTAMP WITH TIME ZONE,
  record_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(category, year)
);

CREATE INDEX IF NOT EXISTS idx_file_metadata_category_year
  ON file_metadata(category, year);
CREATE INDEX IF NOT EXISTS idx_file_metadata_hash
  ON file_metadata(file_hash);

CREATE TABLE IF NOT EXISTS dynamic_table_metadata (
  id SERIAL PRIMARY KEY,
  table_name TEXT UNIQUE NOT NULL,
  schema_name TEXT NOT NULL DEFAULT 'raw',
  columns_json JSONB NULL,
  needs_geom_update BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS map_features (
  id SERIAL PRIMARY KEY,
  num_bo TEXT NOT NULL,
  ano_bo INTEGER NOT NULL,
  delegacia TEXT,
  latitude NUMERIC(10, 6) NOT NULL,
  longitude NUMERIC(10, 6) NOT NULL,
  location_hash TEXT NOT NULL,
  geom GEOMETRY(Point, 4326) NOT NULL,
  category TEXT NOT NULL,
  rubrica_for_styling TEXT NOT NULL,
  data_ocorrencia DATE,
  source_tables TEXT[] NOT NULL DEFAULT '{}',
  feature_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_map_features_bo_delegacia_location
  ON map_features (num_bo, ano_bo, COALESCE(delegacia, ''), location_hash);

CREATE INDEX IF NOT EXISTS idx_map_features_geom
  ON map_features USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_map_features_date
  ON map_features (data_ocorrencia);
CREATE INDEX IF NOT EXISTS idx_map_features_category
  ON map_features (category);
CREATE INDEX IF NOT EXISTS idx_map_features_date_category
  ON map_features (data_ocorrencia, category);
CREATE INDEX IF NOT EXISTS idx_map_features_ano
  ON map_features (ano_bo);
CREATE INDEX IF NOT EXISTS idx_map_features_delegacia
  ON map_features (delegacia);
CREATE INDEX IF NOT EXISTS idx_map_features_num_bo_delegacia
  ON map_features (num_bo, ano_bo, delegacia);

CREATE TABLE IF NOT EXISTS map_features_etl_status (
  id SERIAL PRIMARY KEY,
  source_table TEXT NOT NULL UNIQUE,
  last_etl_at TIMESTAMP,
  rows_processed INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_file_metadata_updated_at ON file_metadata;
CREATE TRIGGER trg_file_metadata_updated_at
BEFORE UPDATE ON file_metadata
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_dynamic_table_metadata_updated_at ON dynamic_table_metadata;
CREATE TRIGGER trg_dynamic_table_metadata_updated_at
BEFORE UPDATE ON dynamic_table_metadata
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_map_features_updated_at ON map_features;
CREATE TRIGGER trg_map_features_updated_at
BEFORE UPDATE ON map_features
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_map_features_etl_status_updated_at ON map_features_etl_status;
CREATE TRIGGER trg_map_features_etl_status_updated_at
BEFORE UPDATE ON map_features_etl_status
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
