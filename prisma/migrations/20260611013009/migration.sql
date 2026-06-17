/*
  Warnings:

  - Made the column `needs_geom_update` on table `dynamic_table_metadata` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `dynamic_table_metadata` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updated_at` on table `dynamic_table_metadata` required. This step will fail if there are existing NULL values in that column.
  - Made the column `last_downloaded` on table `file_metadata` required. This step will fail if there are existing NULL values in that column.
  - Made the column `record_count` on table `file_metadata` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `file_metadata` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updated_at` on table `file_metadata` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `map_features` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updated_at` on table `map_features` required. This step will fail if there are existing NULL values in that column.
  - Made the column `rows_processed` on table `map_features_etl_status` required. This step will fail if there are existing NULL values in that column.
  - Made the column `status` on table `map_features_etl_status` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `map_features_etl_status` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updated_at` on table `map_features_etl_status` required. This step will fail if there are existing NULL values in that column.

*/
-- Preserve the manually-managed PostGIS GiST index.
-- Prisma cannot represent the Unsupported("geometry(Point, 4326)") index in
-- schema.prisma, but MVT and bounds queries depend on it.
CREATE INDEX IF NOT EXISTS "idx_map_features_geom"
ON "map_features" USING GIST ("geom");

-- AlterTable
ALTER TABLE "dynamic_table_metadata" ALTER COLUMN "needs_geom_update" SET NOT NULL,
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "updated_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "file_metadata" ALTER COLUMN "last_downloaded" SET NOT NULL,
ALTER COLUMN "record_count" SET NOT NULL,
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "updated_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "map_features" ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "updated_at" SET NOT NULL;

-- AlterTable
ALTER TABLE "map_features_etl_status" ALTER COLUMN "rows_processed" SET NOT NULL,
ALTER COLUMN "status" SET NOT NULL,
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "updated_at" SET NOT NULL;
