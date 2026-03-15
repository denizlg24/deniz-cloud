-- Deniz Cloud: Full database schema
-- Runs automatically on first Postgres start via /docker-entrypoint-initdb.d/

-- Enums
CREATE TYPE "user_role" AS ENUM ('superuser', 'user');
CREATE TYPE "user_status" AS ENUM ('pending', 'active');
CREATE TYPE "storage_tier" AS ENUM ('ssd', 'hdd');
CREATE TYPE "upload_status" AS ENUM ('in_progress', 'completed', 'expired');
CREATE TYPE "sync_status" AS ENUM ('idle', 'syncing', 'error');

-- Users
CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "username" varchar(255) NOT NULL UNIQUE,
  "email" varchar(255),
  "password_hash" text,
  "role" "user_role" NOT NULL DEFAULT 'user',
  "status" "user_status" NOT NULL DEFAULT 'active',
  "totp_enabled" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Sessions
CREATE TABLE "sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX "sessions_user_id_idx" ON "sessions" ("user_id");
CREATE INDEX "sessions_expires_at_idx" ON "sessions" ("expires_at");

-- TOTP Secrets
CREATE TABLE "totp_secrets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE UNIQUE,
  "encrypted_secret" text NOT NULL,
  "iv" text NOT NULL,
  "auth_tag" text NOT NULL,
  "verified" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Recovery Codes
CREATE TABLE "recovery_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "code_hash" text NOT NULL,
  "used" boolean NOT NULL DEFAULT false,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX "recovery_codes_user_id_idx" ON "recovery_codes" ("user_id");

-- Folders
CREATE TABLE "folders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "parent_id" uuid,
  "path" text NOT NULL UNIQUE,
  "name" varchar(255) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX "folders_owner_id_idx" ON "folders" ("owner_id");
CREATE INDEX "folders_parent_id_idx" ON "folders" ("parent_id");

-- Projects
CREATE TABLE "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(255) NOT NULL,
  "slug" varchar(255) NOT NULL UNIQUE,
  "description" text,
  "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "storage_folder_id" uuid REFERENCES "folders"("id") ON DELETE SET NULL,
  "meili_api_key_uid" text,
  "meili_api_key" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX "projects_owner_id_idx" ON "projects" ("owner_id");
CREATE INDEX "projects_slug_idx" ON "projects" ("slug");

-- API Keys
CREATE TABLE "api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "key_hash" text NOT NULL,
  "key_prefix" varchar(12) NOT NULL,
  "scopes" jsonb NOT NULL DEFAULT '[]',
  "expires_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" ("user_id");
CREATE INDEX "api_keys_project_id_idx" ON "api_keys" ("project_id");
CREATE INDEX "api_keys_key_prefix_idx" ON "api_keys" ("key_prefix");

-- Project Collections (MongoDB → Meilisearch sync)
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

-- Files
CREATE TABLE "files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "folder_id" uuid NOT NULL REFERENCES "folders"("id") ON DELETE CASCADE,
  "filename" varchar(255) NOT NULL,
  "path" text NOT NULL UNIQUE,
  "mime_type" varchar(255),
  "size_bytes" bigint NOT NULL,
  "checksum" varchar(64) NOT NULL,
  "tier" "storage_tier" NOT NULL DEFAULT 'ssd',
  "disk_path" text NOT NULL,
  "last_accessed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "access_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX "files_owner_id_idx" ON "files" ("owner_id");
CREATE INDEX "files_folder_id_idx" ON "files" ("folder_id");
CREATE INDEX "files_tier_idx" ON "files" ("tier");
CREATE INDEX "files_last_accessed_at_idx" ON "files" ("last_accessed_at");

-- TUS Uploads
CREATE TABLE "tus_uploads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "filename" varchar(255) NOT NULL,
  "target_path" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "bytes_received" bigint NOT NULL DEFAULT 0,
  "mime_type" varchar(255),
  "metadata" jsonb,
  "temp_disk_path" text NOT NULL,
  "status" "upload_status" NOT NULL DEFAULT 'in_progress',
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX "tus_uploads_owner_id_idx" ON "tus_uploads" ("owner_id");
CREATE INDEX "tus_uploads_status_idx" ON "tus_uploads" ("status");
CREATE INDEX "tus_uploads_expires_at_idx" ON "tus_uploads" ("expires_at");
