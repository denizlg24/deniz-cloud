-- Phase 5: MongoDB ↔ Meilisearch Sync
-- Adds project_collections table, removes deprecated search_projects table

-- Create sync status enum
CREATE TYPE "sync_status" AS ENUM ('idle', 'syncing', 'error');

-- Create project_collections table
CREATE TABLE "project_collections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "mongo_database" varchar(255) NOT NULL,
  "mongo_collection" varchar(255) NOT NULL,
  "meili_index_uid" varchar(255) NOT NULL UNIQUE,
  "field_mapping" jsonb NOT NULL DEFAULT '{}',
  "sync_enabled" boolean NOT NULL DEFAULT true,
  "sync_status" "sync_status" NOT NULL DEFAULT 'idle',
  "resume_token" jsonb,
  "last_synced_at" timestamp with time zone,
  "last_error" text,
  "document_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE("project_id", "name")
);

CREATE INDEX "project_collections_project_id_idx" ON "project_collections" ("project_id");

-- Drop deprecated search_projects table
DROP TABLE IF EXISTS "search_projects";
