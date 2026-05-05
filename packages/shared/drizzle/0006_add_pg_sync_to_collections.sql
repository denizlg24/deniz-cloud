-- Postgres source support for project_collections
DO $$ BEGIN
  CREATE TYPE "public"."collection_source_type" AS ENUM('mongodb', 'postgres');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "project_collections"
  ADD COLUMN IF NOT EXISTS "source_type" "collection_source_type" NOT NULL DEFAULT 'mongodb';

ALTER TABLE "project_collections" ALTER COLUMN "mongo_database" DROP NOT NULL;
ALTER TABLE "project_collections" ALTER COLUMN "mongo_collection" DROP NOT NULL;

ALTER TABLE "project_collections"
  ADD COLUMN IF NOT EXISTS "pg_database" varchar(255),
  ADD COLUMN IF NOT EXISTS "pg_schema" varchar(255),
  ADD COLUMN IF NOT EXISTS "pg_table" varchar(255),
  ADD COLUMN IF NOT EXISTS "pg_id_column" varchar(255),
  ADD COLUMN IF NOT EXISTS "pg_outbox_cursor" bigint NOT NULL DEFAULT 0;
