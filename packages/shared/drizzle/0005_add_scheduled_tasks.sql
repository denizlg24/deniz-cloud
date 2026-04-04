-- Task scheduling and backup system
DO $$ BEGIN
  CREATE TYPE "public"."task_type" AS ENUM('backup_postgres', 'backup_mongodb', 'backup_files', 'backup_all', 'restart_container', 'reboot_server');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."task_run_status" AS ENUM('pending', 'running', 'completed', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "scheduled_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(255) NOT NULL,
  "type" "task_type" NOT NULL,
  "cron_expression" varchar(100),
  "scheduled_at" timestamp with time zone,
  "next_run_at" timestamp with time zone,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "task_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "scheduled_tasks"("id") ON DELETE CASCADE,
  "status" "task_run_status" DEFAULT 'pending' NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "output" text,
  "error" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "scheduled_tasks_type_idx" ON "scheduled_tasks" USING btree ("type");
CREATE INDEX IF NOT EXISTS "scheduled_tasks_next_run_at_idx" ON "scheduled_tasks" USING btree ("next_run_at");
CREATE INDEX IF NOT EXISTS "scheduled_tasks_enabled_idx" ON "scheduled_tasks" USING btree ("enabled");

CREATE INDEX IF NOT EXISTS "task_runs_task_id_idx" ON "task_runs" USING btree ("task_id");
CREATE INDEX IF NOT EXISTS "task_runs_status_idx" ON "task_runs" USING btree ("status");
CREATE INDEX IF NOT EXISTS "task_runs_started_at_idx" ON "task_runs" USING btree ("started_at");
