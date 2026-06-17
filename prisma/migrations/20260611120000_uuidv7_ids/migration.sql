ALTER TABLE "file_metadata" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "file_metadata" ALTER COLUMN "id" TYPE uuid USING uuidv7();
ALTER TABLE "file_metadata" ALTER COLUMN "id" SET DEFAULT uuidv7();
DROP SEQUENCE IF EXISTS "file_metadata_id_seq";

ALTER TABLE "dynamic_table_metadata" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "dynamic_table_metadata" ALTER COLUMN "id" TYPE uuid USING uuidv7();
ALTER TABLE "dynamic_table_metadata" ALTER COLUMN "id" SET DEFAULT uuidv7();
DROP SEQUENCE IF EXISTS "dynamic_table_metadata_id_seq";

ALTER TABLE "map_features" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "map_features" ALTER COLUMN "id" TYPE uuid USING uuidv7();
ALTER TABLE "map_features" ALTER COLUMN "id" SET DEFAULT uuidv7();
DROP SEQUENCE IF EXISTS "map_features_id_seq";

ALTER TABLE "map_features_etl_status" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "map_features_etl_status" ALTER COLUMN "id" TYPE uuid USING uuidv7();
ALTER TABLE "map_features_etl_status" ALTER COLUMN "id" SET DEFAULT uuidv7();
DROP SEQUENCE IF EXISTS "map_features_etl_status_id_seq";
