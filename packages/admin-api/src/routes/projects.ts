import type { Database } from "@deniz-cloud/shared/db";
import { projects } from "@deniz-cloud/shared/db/schema";
import { type AuthVariables, requireScope } from "@deniz-cloud/shared/middleware";
import {
  createProjectSearchKey,
  deleteAllProjectIndexes,
  deleteProjectSearchKey,
  generateProjectToken,
  scopedIndexName,
  type TenantSearchRules,
  validateSearchRules,
} from "@deniz-cloud/shared/search";
import {
  createApiKey,
  createCollection,
  createProject,
  deleteCollection,
  deleteProject,
  getCollection,
  getProject,
  listApiKeys,
  listCollections,
  listProjects,
  revokeApiKey,
  updateCollection,
  updateProject,
} from "@deniz-cloud/shared/services";
import {
  dropPgTrigger,
  ensureOutboxTable,
  installPgTrigger,
  type PgClientFactory,
  type SyncWorker,
} from "@deniz-cloud/shared/sync";
import { API_KEY_SCOPES, type ApiKeyScope } from "@deniz-cloud/shared/types";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { MeiliSearch } from "meilisearch";

interface ProjectRouteDeps {
  db: Database;
  meiliClient: MeiliSearch;
  syncWorker: SyncWorker;
  pgClientFactory: PgClientFactory;
}

const PG_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

function stubPgCollection(projectId: string, pgDatabase: string) {
  return {
    id: "lookup",
    projectId,
    pgDatabase,
    sourceType: "postgres" as const,
  } as unknown as import("@deniz-cloud/shared/db/schema").ProjectCollection;
}

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

function parseExpiration(value: string): Date | undefined {
  const durations: Record<string, number> = {
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
    "1y": 365 * 24 * 60 * 60 * 1000,
  };
  const ms = durations[value];
  if (!ms) return undefined;
  return new Date(Date.now() + ms);
}

const COLLECTION_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

async function ensureMeiliKey(
  db: Database,
  meiliClient: MeiliSearch,
  projectId: string,
  projectSlug: string,
): Promise<{ apiKey: string; apiKeyUid: string }> {
  const project = await getProject(db, projectId);
  if (project.meiliApiKey && project.meiliApiKeyUid) {
    return { apiKey: project.meiliApiKey, apiKeyUid: project.meiliApiKeyUid };
  }

  const { key, uid } = await createProjectSearchKey(meiliClient, projectSlug);

  await db
    .update(projects)
    .set({ meiliApiKey: key, meiliApiKeyUid: uid, updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  return { apiKey: key, apiKeyUid: uid };
}

export function projectRoutes({ db, meiliClient, syncWorker, pgClientFactory }: ProjectRouteDeps) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/", async (c) => {
    const page = parseInt(c.req.query("page") ?? "1", 10);
    const limit = parseInt(c.req.query("limit") ?? "50", 10);

    if (page < 1 || limit < 1 || limit > 100) {
      return c.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Invalid pagination parameters",
          },
        },
        400,
      );
    }

    const result = await listProjects(db, { page, limit });

    return c.json({
      data: result.projects,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    });
  });

  app.get("/:id", async (c) => {
    const project = await getProject(db, c.req.param("id"));
    return c.json({ data: project });
  });

  app.post("/", async (c) => {
    const body = await c.req.json();
    const user = c.get("user");

    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return c.json(
        {
          error: { code: "INVALID_INPUT", message: "Project name is required" },
        },
        400,
      );
    }

    if (typeof body.slug !== "string" || !SLUG_REGEX.test(body.slug)) {
      return c.json(
        {
          error: {
            code: "INVALID_INPUT",
            message:
              "Slug must be 3-64 characters: lowercase letters, numbers, hyphens (no leading/trailing hyphens)",
          },
        },
        400,
      );
    }

    const project = await createProject(db, {
      name: body.name.trim(),
      slug: body.slug.toLowerCase(),
      description: typeof body.description === "string" ? body.description.trim() : undefined,
      ownerId: user.id,
      storageRootPath: `/${body.slug.toLowerCase()}`,
    });

    return c.json({ data: project }, 201);
  });

  app.patch("/:id", async (c) => {
    const body = await c.req.json();
    const input: { name?: string; description?: string } = {};

    if (typeof body.name === "string" && body.name.trim().length > 0) {
      input.name = body.name.trim();
    }
    if (typeof body.description === "string") {
      input.description = body.description.trim();
    }

    if (Object.keys(input).length === 0) {
      return c.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "No valid fields to update",
          },
        },
        400,
      );
    }

    const project = await updateProject(db, c.req.param("id"), input);
    return c.json({ data: project });
  });

  app.delete("/:id", async (c) => {
    const projectId = c.req.param("id");
    const project = await getProject(db, projectId);

    // Clean up Meilisearch resources before deleting
    if (project.meiliApiKeyUid) {
      try {
        await deleteAllProjectIndexes(meiliClient, project.slug);
        await deleteProjectSearchKey(meiliClient, project.meiliApiKeyUid);
      } catch {
        // Meilisearch resources may already be gone
      }
    }

    await deleteProject(db, projectId);
    return c.json({ data: { success: true } });
  });

  app.get("/:id/api-keys", async (c) => {
    const projectId = c.req.param("id");
    await getProject(db, projectId);
    const keys = await listApiKeys(db, projectId);
    return c.json({ data: keys });
  });

  app.post("/:id/api-keys", async (c) => {
    const projectId = c.req.param("id");
    const user = c.get("user");
    const body = await c.req.json();

    await getProject(db, projectId);

    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return c.json(
        {
          error: { code: "INVALID_INPUT", message: "API key name is required" },
        },
        400,
      );
    }

    if (!Array.isArray(body.scopes) || body.scopes.length === 0) {
      return c.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "At least one scope is required",
          },
        },
        400,
      );
    }

    const invalidScopes = body.scopes.filter(
      (s: unknown) => typeof s !== "string" || !API_KEY_SCOPES.includes(s as ApiKeyScope),
    );
    if (invalidScopes.length > 0) {
      return c.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: `Invalid scopes: ${invalidScopes.join(", ")}. Valid: ${API_KEY_SCOPES.join(", ")}`,
          },
        },
        400,
      );
    }

    const expiresAt =
      typeof body.expiresIn === "string" ? parseExpiration(body.expiresIn) : undefined;

    const result = await createApiKey(db, {
      userId: user.id,
      projectId,
      name: body.name.trim(),
      scopes: body.scopes as ApiKeyScope[],
      expiresAt,
    });

    return c.json({ data: result }, 201);
  });

  app.delete("/:id/api-keys/:keyId", async (c) => {
    const projectId = c.req.param("id");
    const keyId = c.req.param("keyId");
    await revokeApiKey(db, keyId, projectId);
    return c.json({ data: { success: true } });
  });

  app.get("/:id/collections", requireScope("search:read"), async (c) => {
    const projectId = c.req.param("id");
    await getProject(db, projectId);
    const collections = await listCollections(db, projectId);
    return c.json({ data: collections });
  });

  app.post("/:id/collections", requireScope("search:manage"), async (c) => {
    const project = await getProject(db, c.req.param("id"));
    const body = await c.req.json();

    if (typeof body.name !== "string" || !COLLECTION_NAME_PATTERN.test(body.name)) {
      return c.json(
        {
          error: {
            code: "INVALID_INPUT",
            message:
              "Collection name must be lowercase alphanumeric with hyphens (no leading/trailing hyphens)",
          },
        },
        400,
      );
    }
    if (body.name.length > 50) {
      return c.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Collection name must be 50 characters or fewer",
          },
        },
        400,
      );
    }

    const sourceType: "mongodb" | "postgres" =
      body.sourceType === "postgres" ? "postgres" : "mongodb";

    if (sourceType === "mongodb") {
      if (typeof body.mongoDatabase !== "string" || body.mongoDatabase.trim().length === 0) {
        return c.json(
          { error: { code: "INVALID_INPUT", message: "MongoDB database name is required" } },
          400,
        );
      }
      if (typeof body.mongoCollection !== "string" || body.mongoCollection.trim().length === 0) {
        return c.json(
          { error: { code: "INVALID_INPUT", message: "MongoDB collection name is required" } },
          400,
        );
      }
    } else {
      for (const field of ["pgDatabase", "pgSchema", "pgTable", "pgIdColumn"] as const) {
        const v = body[field];
        if (typeof v !== "string" || !PG_IDENTIFIER_RE.test(v)) {
          return c.json(
            { error: { code: "INVALID_INPUT", message: `${field} must be a valid identifier` } },
            400,
          );
        }
      }
    }

    await ensureMeiliKey(db, meiliClient, project.id, project.slug);

    const meiliIndexUid = scopedIndexName(project.slug, body.name);

    const collection = await createCollection(db, {
      projectId: project.id,
      name: body.name,
      sourceType,
      meiliIndexUid,
      fieldMapping: body.fieldMapping ?? {},
      mongoDatabase: sourceType === "mongodb" ? body.mongoDatabase.trim() : undefined,
      mongoCollection: sourceType === "mongodb" ? body.mongoCollection.trim() : undefined,
      pgDatabase: sourceType === "postgres" ? body.pgDatabase : undefined,
      pgSchema: sourceType === "postgres" ? body.pgSchema : undefined,
      pgTable: sourceType === "postgres" ? body.pgTable : undefined,
      pgIdColumn: sourceType === "postgres" ? body.pgIdColumn : undefined,
    });

    if (sourceType === "postgres") {
      try {
        const { sql, close } = await pgClientFactory.forCollection(collection);
        try {
          await ensureOutboxTable(sql);
          await installPgTrigger(sql, body.pgSchema, body.pgTable, body.pgIdColumn);
        } finally {
          await close();
        }
      } catch (err) {
        console.error("[projects] Failed to install PG trigger; rolling back collection:", err);
        await deleteCollection(db, collection.id).catch(() => undefined);
        return c.json(
          {
            error: {
              code: "PG_PROVISION_FAILED",
              message: err instanceof Error ? err.message : "Failed to provision PG trigger",
            },
          },
          500,
        );
      }
    }

    try {
      await syncWorker.addCollection(collection);
    } catch (err) {
      console.error("[projects] Failed to start sync for new collection:", err);
    }

    return c.json({ data: collection }, 201);
  });

  app.get("/:id/collections/:cid", async (c) => {
    const projectId = c.req.param("id");
    await getProject(db, projectId);
    const collection = await getCollection(db, c.req.param("cid"));

    if (collection.projectId !== projectId) {
      return c.json(
        {
          error: {
            code: "COLLECTION_NOT_FOUND",
            message: "Collection not found",
          },
        },
        404,
      );
    }

    return c.json({ data: collection });
  });

  app.patch("/:id/collections/:cid", requireScope("search:manage"), async (c) => {
    const projectId = c.req.param("id");
    await getProject(db, projectId);
    const collectionId = c.req.param("cid");

    const existing = await getCollection(db, collectionId);
    if (existing.projectId !== projectId) {
      return c.json(
        {
          error: {
            code: "COLLECTION_NOT_FOUND",
            message: "Collection not found",
          },
        },
        404,
      );
    }

    const body = await c.req.json();
    const input: {
      fieldMapping?: Record<string, unknown>;
      syncEnabled?: boolean;
    } = {};

    if (body.fieldMapping !== undefined) {
      input.fieldMapping = body.fieldMapping;
    }
    if (typeof body.syncEnabled === "boolean") {
      input.syncEnabled = body.syncEnabled;
    }

    if (Object.keys(input).length === 0) {
      return c.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "No valid fields to update",
          },
        },
        400,
      );
    }

    const updated = await updateCollection(db, collectionId, input);

    if (input.fieldMapping !== undefined) {
      try {
        await meiliClient.index(existing.meiliIndexUid).updateSettings({
          searchableAttributes: updated.fieldMapping.searchableAttributes ?? ["*"],
          filterableAttributes: updated.fieldMapping.filterableAttributes ?? [],
          sortableAttributes: updated.fieldMapping.sortableAttributes ?? [],
        });
      } catch (err) {
        console.error("[projects] Failed to update Meilisearch settings:", err);
      }

      // Auto-resync when field mapping changes
      try {
        await syncWorker.resyncCollection(collectionId);
      } catch (err) {
        console.error("[projects] Failed to trigger resync after field mapping change:", err);
      }
    }

    if (input.syncEnabled === true && !existing.syncEnabled) {
      try {
        await syncWorker.addCollection(updated);
      } catch (err) {
        console.error("[projects] Failed to start sync:", err);
      }
    } else if (input.syncEnabled === false && existing.syncEnabled) {
      await syncWorker.removeCollection(collectionId);
    }

    return c.json({ data: updated });
  });

  app.delete("/:id/collections/:cid", requireScope("search:manage"), async (c) => {
    const projectId = c.req.param("id");
    await getProject(db, projectId);
    const collectionId = c.req.param("cid");

    const collection = await getCollection(db, collectionId);
    if (collection.projectId !== projectId) {
      return c.json(
        {
          error: {
            code: "COLLECTION_NOT_FOUND",
            message: "Collection not found",
          },
        },
        404,
      );
    }

    await syncWorker.removeCollection(collectionId);

    if (collection.sourceType === "postgres" && collection.pgSchema && collection.pgTable) {
      try {
        const { sql, close } = await pgClientFactory.forCollection(collection);
        try {
          await dropPgTrigger(sql, collection.pgSchema, collection.pgTable);
        } finally {
          await close();
        }
      } catch (err) {
        console.error("[projects] Failed to drop PG trigger:", err);
      }
    }

    try {
      await meiliClient.deleteIndex(collection.meiliIndexUid).waitTask();
    } catch {
      // index may not exist
    }

    await deleteCollection(db, collectionId);
    return c.json({ data: { success: true } });
  });

  app.post("/:id/collections/:cid/resync", requireScope("search:manage"), async (c) => {
    const projectId = c.req.param("id");
    await getProject(db, projectId);
    const collectionId = c.req.param("cid");

    const collection = await getCollection(db, collectionId);
    if (collection.projectId !== projectId) {
      return c.json(
        {
          error: {
            code: "COLLECTION_NOT_FOUND",
            message: "Collection not found",
          },
        },
        404,
      );
    }

    try {
      await syncWorker.resyncCollection(collectionId);
      return c.json({ data: { success: true, message: "Resync started" } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: { code: "RESYNC_FAILED", message } }, 500);
    }
  });

  app.get("/:id/pg-databases", requireScope("search:read"), async (c) => {
    const projectId = c.req.param("id");
    await getProject(db, projectId);
    const { projectDatabases } = await import("@deniz-cloud/shared/db/schema");
    const { and: drizzleAnd } = await import("drizzle-orm");
    const records = await db
      .select({ dbName: projectDatabases.dbName })
      .from(projectDatabases)
      .where(
        drizzleAnd(
          eq(projectDatabases.projectId, projectId),
          eq(projectDatabases.type, "postgres"),
        ),
      );
    return c.json({
      data: records.filter((r) => r.dbName).map((r) => ({ name: r.dbName })),
    });
  });

  app.get("/:id/pg-schemas", requireScope("search:read"), async (c) => {
    const projectId = c.req.param("id");
    await getProject(db, projectId);
    const dbName = c.req.query("database");
    if (!dbName || !PG_IDENTIFIER_RE.test(dbName)) {
      return c.json({ error: { code: "INVALID_INPUT", message: "database required" } }, 400);
    }

    const collection = stubPgCollection(projectId, dbName);
    const { sql, close } = await pgClientFactory.forCollection(collection);
    try {
      const rows = await sql<Array<{ name: string }>>`
        SELECT nspname AS name FROM pg_namespace
        WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          AND nspname NOT LIKE 'pg_temp_%'
          AND nspname NOT LIKE 'pg_toast_temp_%'
        ORDER BY nspname
      `;
      return c.json({ data: rows });
    } finally {
      await close();
    }
  });

  app.get("/:id/pg-tables", requireScope("search:read"), async (c) => {
    const projectId = c.req.param("id");
    await getProject(db, projectId);
    const dbName = c.req.query("database");
    const schema = c.req.query("schema") ?? "public";
    if (!dbName || !PG_IDENTIFIER_RE.test(dbName) || !PG_IDENTIFIER_RE.test(schema)) {
      return c.json({ error: { code: "INVALID_INPUT", message: "Invalid database/schema" } }, 400);
    }

    const collection = stubPgCollection(projectId, dbName);
    const { sql, close } = await pgClientFactory.forCollection(collection);
    try {
      const rows = await sql<Array<{ name: string }>>`
        SELECT tablename AS name FROM pg_tables
        WHERE schemaname = ${schema}
          AND tablename <> '_meili_outbox'
        ORDER BY tablename
      `;
      return c.json({ data: rows });
    } finally {
      await close();
    }
  });

  app.get("/:id/pg-tables/:schema/:table/columns", requireScope("search:read"), async (c) => {
    const projectId = c.req.param("id");
    await getProject(db, projectId);
    const dbName = c.req.query("database");
    const schema = c.req.param("schema");
    const table = c.req.param("table");
    if (
      !dbName ||
      !PG_IDENTIFIER_RE.test(dbName) ||
      !PG_IDENTIFIER_RE.test(schema) ||
      !PG_IDENTIFIER_RE.test(table)
    ) {
      return c.json({ error: { code: "INVALID_INPUT", message: "Invalid identifiers" } }, 400);
    }

    const collection = stubPgCollection(projectId, dbName);
    const { sql, close } = await pgClientFactory.forCollection(collection);
    try {
      const [columns, pkRows] = await Promise.all([
        sql<Array<{ name: string; type: string; nullable: boolean }>>`
          SELECT a.attname AS name,
                 format_type(a.atttypid, a.atttypmod) AS type,
                 NOT a.attnotnull AS nullable
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ${schema}
            AND c.relname = ${table}
            AND a.attnum > 0
            AND NOT a.attisdropped
          ORDER BY a.attnum
        `,
        sql<Array<{ column: string }>>`
          SELECT a.attname AS column
          FROM pg_index i
          JOIN pg_class c ON c.oid = i.indrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
          WHERE n.nspname = ${schema}
            AND c.relname = ${table}
            AND i.indisprimary
          ORDER BY array_position(i.indkey, a.attnum)
        `,
      ]);
      const pkColumns = pkRows.map((r) => r.column);
      return c.json({
        data: {
          columns: columns.map((col) => ({
            name: col.name,
            type: col.type,
            nullable: col.nullable,
            isPrimaryKey: pkColumns.includes(col.name),
          })),
          primaryKey: pkColumns,
        },
      });
    } finally {
      await close();
    }
  });

  app.post("/:id/collections/discover-fields", requireScope("search:read"), async (c) => {
    const projectId = c.req.param("id");
    await getProject(db, projectId);
    const body = await c.req.json();

    if (body.sourceType === "postgres") {
      const { pgDatabase, pgSchema, pgTable } = body;
      if (
        typeof pgDatabase !== "string" ||
        typeof pgSchema !== "string" ||
        typeof pgTable !== "string" ||
        !PG_IDENTIFIER_RE.test(pgDatabase) ||
        !PG_IDENTIFIER_RE.test(pgSchema) ||
        !PG_IDENTIFIER_RE.test(pgTable)
      ) {
        return c.json({ error: { code: "INVALID_INPUT", message: "Invalid PG identifiers" } }, 400);
      }
      const collection = stubPgCollection(projectId, pgDatabase);
      const { sql, close } = await pgClientFactory.forCollection(collection);
      try {
        const rows = await sql<Array<{ name: string; type: string }>>`
          SELECT a.attname AS name,
                 format_type(a.atttypid, a.atttypmod) AS type
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ${pgSchema}
            AND c.relname = ${pgTable}
            AND a.attnum > 0
            AND NOT a.attisdropped
          ORDER BY a.attnum
        `;
        return c.json({
          data: {
            fields: rows.map((r) => ({ name: r.name, types: [r.type] })),
            sampleCount: rows.length,
          },
        });
      } finally {
        await close();
      }
    }

    if (typeof body.mongoDatabase !== "string" || body.mongoDatabase.trim().length === 0) {
      return c.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "MongoDB database name is required",
          },
        },
        400,
      );
    }
    if (typeof body.mongoCollection !== "string" || body.mongoCollection.trim().length === 0) {
      return c.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "MongoDB collection name is required",
          },
        },
        400,
      );
    }

    try {
      const { getMongoClient } = await import("@deniz-cloud/shared/mongo");
      const mongo = getMongoClient();
      const mongoDb = mongo.db(body.mongoDatabase.trim());
      const coll = mongoDb.collection(body.mongoCollection.trim());

      const sample = await coll.find({}).limit(100).toArray();

      if (sample.length === 0) {
        return c.json({ data: { fields: [], sampleCount: 0 } });
      }

      const fieldTypes = new Map<string, Set<string>>();

      for (const doc of sample) {
        for (const [key, value] of Object.entries(doc)) {
          if (key === "_id") continue;
          if (!fieldTypes.has(key)) fieldTypes.set(key, new Set());
          const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
          fieldTypes.get(key)?.add(type);
        }
      }

      const fields = Array.from(fieldTypes.entries()).map(([name, types]) => ({
        name,
        types: Array.from(types),
      }));

      return c.json({ data: { fields, sampleCount: sample.length } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: { code: "DISCOVERY_FAILED", message } }, 500);
    }
  });

  app.post("/:id/search-token", requireScope("search:read"), async (c) => {
    const project = await getProject(db, c.req.param("id"));

    if (!project.meiliApiKey || !project.meiliApiKeyUid) {
      return c.json(
        {
          error: {
            code: "SEARCH_NOT_CONFIGURED",
            message: "Project has no search collections. Create a collection first.",
          },
        },
        400,
      );
    }

    const body = await c.req.json().catch(() => ({}));
    const expiresInHours =
      typeof body.expiresInHours === "number" && body.expiresInHours > 0
        ? Math.min(body.expiresInHours, 720)
        : 24;

    let searchRules: TenantSearchRules | undefined;
    if (
      body.searchRules &&
      typeof body.searchRules === "object" &&
      !Array.isArray(body.searchRules)
    ) {
      searchRules = body.searchRules as TenantSearchRules;
      const validationError = validateSearchRules(searchRules, project.slug);
      if (validationError) {
        return c.json({ error: { code: "INVALID_SEARCH_RULES", message: validationError } }, 400);
      }
    }

    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    const token = await generateProjectToken({
      apiKey: project.meiliApiKey,
      apiKeyUid: project.meiliApiKeyUid,
      projectName: project.slug,
      searchRules,
      expiresAt,
    });

    return c.json({
      data: { token, expiresAt: expiresAt.toISOString() },
    });
  });

  return app;
}
