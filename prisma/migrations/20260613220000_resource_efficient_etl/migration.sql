CREATE INDEX IF NOT EXISTS "idx_map_features_source_tables_gin"
ON "map_features" USING GIN ("source_tables");

ALTER TABLE "map_features" SET (
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 5000,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 10000,
  autovacuum_vacuum_cost_delay = 10
);
