import { decryptTotpSecret, encryptTotpSecret } from "@deniz-cloud/shared/auth";
import { createRawClient, type Database, projectDatabases, projects } from "@deniz-cloud/shared/db";
import type { AuthVariables } from "@deniz-cloud/shared/middleware";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { MongoClient } from "mongodb";
import { randomBytes } from "node:crypto";

interface ProjectDatabaseRouteDeps {
  db: Database;
  databaseUrl: string;
  mongoAdminClient: MongoClient;
  totpEncryptionKey: string;
  postgresInternalHost: string;
  postgresExternalHost: string;
  mongodbInternalHost: string;
  mongodbExternalHost: string;
}

function generatePassword(): string {
  return randomBytes(16).toString("hex");
}

function buildPgUri(username: string, password: string, host: string, dbName: string): string {
  return `postgresql://${username}:${encodeURIComponent(password)}@${host}/${dbName}`;
}

function buildMongoUri(username: string, password: string, host: string, dbName: string): string {
  return `mongodb://${username}:${encodeURIComponent(password)}@${host}/${dbName}`;
}

function formatRecord(
  record: typeof projectDatabases.$inferSelect,
  password: string,
  pgInternal: string,
  pgExternal: string,
  mongoInternal: string,
  mongoExternal: string,
) {
  const { encryptedPassword: _enc, iv: _iv, authTag: _tag, ...rest } = record;
  const uris =
    record.type === "postgres"
      ? {
          internal: buildPgUri(record.username, password, pgInternal, record.dbName),
          external: buildPgUri(record.username, password, pgExternal, record.dbName),
        }
      : {
          internal: buildMongoUri(record.username, password, mongoInternal, record.dbName),
          external: buildMongoUri(record.username, password, mongoExternal, record.dbName),
        };
  return { ...rest, password, uris };
}

export function projectDatabaseRoutes({
  db,
  databaseUrl,
  mongoAdminClient,
  totpEncryptionKey,
  postgresInternalHost,
  postgresExternalHost,
  mongodbInternalHost,
  mongodbExternalHost,
}: ProjectDatabaseRouteDeps) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.post("/:projectId/databases", async (c) => {
    const projectId = c.req.param("projectId");
    const body = await c.req.json<{ type: "postgres" | "mongodb" }>();
    const { type } = body;

    if (type !== "postgres" && type !== "mongodb") {
      return c.json({ error: { code: "INVALID_INPUT", message: "type must be postgres or mongodb" } }, 400);
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) {
      return c.json({ error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
    }

    const existing = await db
      .select()
      .from(projectDatabases)
      .where(and(eq(projectDatabases.projectId, projectId), eq(projectDatabases.type, type)))
      .limit(1);
    if (existing.length > 0) {
      return c.json(
        { error: { code: "CONFLICT", message: `A ${type} database already exists for this project` } },
        409,
      );
    }

    const rawSlug = project.slug.replace(/-/g, "_").slice(0, 55);
    const identifier = `proj_${rawSlug}`;
    const password = generatePassword();
    const { encrypted, iv, authTag } = encryptTotpSecret(password, totpEncryptionKey);

    if (type === "postgres") {
      const sql = createRawClient(databaseUrl, { max: 1 });
      try {
        await sql.unsafe(`CREATE ROLE "${identifier}" WITH LOGIN PASSWORD $$${password}$$`);
        await sql.unsafe(`CREATE DATABASE "${identifier}" OWNER "${identifier}"`);
        await sql.unsafe(`GRANT ALL PRIVILEGES ON DATABASE "${identifier}" TO "${identifier}"`);
      } finally {
        await sql.end();
      }
    } else {
      await mongoAdminClient.db(identifier).command({
        createUser: identifier,
        pwd: password,
        roles: [{ role: "dbOwner", db: identifier }],
      });
    }

    const records = await db
      .insert(projectDatabases)
      .values({
        projectId,
        type,
        dbName: identifier,
        username: identifier,
        encryptedPassword: encrypted,
        iv,
        authTag,
      })
      .returning();
    const record = records[0];
    if (!record) {
      return c.json({ error: { code: "INTERNAL_ERROR", message: "Failed to create record" } }, 500);
    }

    return c.json(
      {
        data: formatRecord(
          record,
          password,
          postgresInternalHost,
          postgresExternalHost,
          mongodbInternalHost,
          mongodbExternalHost,
        ),
      },
      201,
    );
  });

  app.get("/:projectId/databases", async (c) => {
    const projectId = c.req.param("projectId");

    const records = await db
      .select()
      .from(projectDatabases)
      .where(eq(projectDatabases.projectId, projectId));

    const data = records.map((r) => {
      const password = decryptTotpSecret(r.encryptedPassword, r.iv, r.authTag, totpEncryptionKey);
      return formatRecord(
        r,
        password,
        postgresInternalHost,
        postgresExternalHost,
        mongodbInternalHost,
        mongodbExternalHost,
      );
    });

    return c.json({ data });
  });

  app.delete("/:projectId/databases/:dbId", async (c) => {
    const projectId = c.req.param("projectId");
    const dbId = c.req.param("dbId");

    const [record] = await db
      .select()
      .from(projectDatabases)
      .where(and(eq(projectDatabases.id, dbId), eq(projectDatabases.projectId, projectId)))
      .limit(1);

    if (!record) {
      return c.json({ error: { code: "NOT_FOUND", message: "Database not found" } }, 404);
    }

    if (record.type === "postgres") {
      const sql = createRawClient(databaseUrl, { max: 1 });
      try {
        await sql.unsafe(`DROP DATABASE IF EXISTS "${record.dbName}" WITH (FORCE)`);
        await sql.unsafe(`DROP ROLE IF EXISTS "${record.username}"`);
      } finally {
        await sql.end();
      }
    } else {
      try {
        await mongoAdminClient.db(record.dbName).command({ dropUser: record.username });
      } catch {
        // user may already be gone
      }
      await mongoAdminClient.db(record.dbName).dropDatabase();
    }

    await db.delete(projectDatabases).where(eq(projectDatabases.id, dbId));

    return c.json({ data: null });
  });

  return app;
}
