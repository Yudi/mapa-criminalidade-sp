-- Preserve manually-managed indexes Prisma cannot represent.
CREATE INDEX IF NOT EXISTS "idx_map_features_geom"
ON "map_features" USING GIST ("geom");

CREATE INDEX IF NOT EXISTS "idx_map_features_all_rubricas_gin"
ON "map_features" USING GIN ("all_rubricas");
