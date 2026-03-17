CREATE TYPE "public"."db_type" AS ENUM('postgres', 'mongodb');

CREATE TABLE "project_databases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "type" "db_type" NOT NULL,
  "db_name" varchar(255) NOT NULL,
  "username" varchar(255) NOT NULL,
  "encrypted_password" text NOT NULL,
  "iv" text NOT NULL,
  "auth_tag" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "project_databases_project_id_idx" ON "project_databases" ("project_id");
CREATE UNIQUE INDEX "project_databases_project_id_type_unique" ON "project_databases" ("project_id", "type");
