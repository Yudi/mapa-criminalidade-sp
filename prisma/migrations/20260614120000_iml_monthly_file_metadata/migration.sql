CREATE TABLE "iml_file_metadata" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "category" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "file_url" TEXT NOT NULL,
  "file_hash" TEXT NOT NULL,
  "file_size" BIGINT,
  "last_downloaded" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_imported" TIMESTAMPTZ(6),
  "record_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "iml_file_metadata_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "iml_file_metadata_month_check" CHECK ("month" BETWEEN 1 AND 12)
);

CREATE UNIQUE INDEX "iml_file_metadata_category_year_month_key"
ON "iml_file_metadata"("category", "year", "month");

CREATE INDEX "idx_iml_file_metadata_category_year"
ON "iml_file_metadata"("category", "year");

CREATE INDEX "idx_iml_file_metadata_hash"
ON "iml_file_metadata"("file_hash");

CREATE TRIGGER "trg_iml_file_metadata_updated_at"
BEFORE UPDATE ON "iml_file_metadata"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
