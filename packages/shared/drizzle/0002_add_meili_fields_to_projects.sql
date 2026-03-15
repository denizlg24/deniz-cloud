-- Migration: Add Meilisearch API key fields to projects table
-- These are nullable — only set when a project creates its first search collection

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "meili_api_key_uid" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "meili_api_key" text;
