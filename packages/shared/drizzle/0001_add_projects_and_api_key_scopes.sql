-- Migration: Add projects table and extend api_keys with projectId + scopes
-- Run against the deniz-cloud PostgreSQL database

-- 1. Create projects table
CREATE TABLE IF NOT EXISTS "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(255) NOT NULL,
  "slug" varchar(255) NOT NULL UNIQUE,
  "description" text,
  "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "storage_folder_id" uuid REFERENCES "folders"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "projects_owner_id_idx" ON "projects" ("owner_id");
CREATE INDEX IF NOT EXISTS "projects_slug_idx" ON "projects" ("slug");

-- 2. Add new columns to api_keys
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "project_id" uuid REFERENCES "projects"("id") ON DELETE CASCADE;
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS "api_keys_project_id_idx" ON "api_keys" ("project_id");

-- 3. Delete any orphaned api_keys that have no project (from before this migration)
-- Then make project_id NOT NULL
DELETE FROM "api_keys" WHERE "project_id" IS NULL;
ALTER TABLE "api_keys" ALTER COLUMN "project_id" SET NOT NULL;
