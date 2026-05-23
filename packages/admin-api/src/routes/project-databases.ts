import { randomBytes } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { decryptTotpSecret, encryptTotpSecret } from "@deniz-cloud/shared/auth";
import { createRawClient, type Database, projectDatabases, projects } from "@deniz-cloud/shared/db";
import type { AuthVariables } from "@deniz-cloud/shared/middleware";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { MongoClient } from "mongodb";

interface ProjectDatabaseRouteDeps {
  db: Database;
  databaseUrl: string;
  mongoAdminClient: MongoClient;
  totpEncryptionKey: string;
  postgresInternalHost: string;
  postgresExternalHost: string;
  mongodbInternalHost: string;
  mongodbExternalHost: string;
  redisAdminUrl: string;
  redisInternalHost: string;
  redisExternalHost: string;
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

function buildRedisUri(username: string, password: string, host: string): string {
  return `redis://${username}:${encodeURIComponent(password)}@${host}`;
}

function encodeRedisCommand(args: string[]): string {
  return `*${args.length}\r\n${args.map((arg) => `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`).join("")}`;
}

type RedisValue = string | number | null | RedisValue[];

class RedisAdminClient {
  private socket: Socket | null = null;
  private buffer = Buffer.alloc(0);

  constructor(private readonly url: string) {}

  async connect(): Promise<void> {
    if (this.socket) return;

    const parsed = new URL(this.url);
    const port = parsed.port ? Number(parsed.port) : 6379;
    const socket = createConnection({ host: parsed.hostname, port });
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });

    const username = decodeURIComponent(parsed.username || "default");
    const password = decodeURIComponent(parsed.password);
    if (password) {
      await this.command("AUTH", username, password);
    }
  }

  async command(...args: string[]): Promise<RedisValue> {
    await this.connect();
    const socket = this.socket;
    if (!socket) throw new Error("Redis socket not connected");

    socket.write(encodeRedisCommand(args));
    return this.readValue();
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    await new Promise<void>((resolve) => {
      socket.end(resolve);
    });
  }

  private async readValue(): Promise<RedisValue> {
    while (true) {
      const parsed = this.parseValue(0);
      if (parsed) {
        this.buffer = this.buffer.subarray(parsed.nextOffset);
        return parsed.value;
      }

      const chunk = await new Promise<Buffer>((resolve, reject) => {
        const socket = this.socket;
        if (!socket) {
          reject(new Error("Redis socket not connected"));
          return;
        }
        socket.once("data", resolve);
        socket.once("error", reject);
      });
      this.buffer = Buffer.concat([this.buffer, chunk]);
    }
  }

  private parseValue(offset: number): { value: RedisValue; nextOffset: number } | null {
    if (offset >= this.buffer.length) return null;

    const prefix = this.buffer.toString("utf8", offset, offset + 1);
    const lineEnd = this.buffer.indexOf("\r\n", offset);
    if (lineEnd === -1) return null;
    const line = this.buffer.toString("utf8", offset + 1, lineEnd);
    const next = lineEnd + 2;

    if (prefix === "+") return { value: line, nextOffset: next };
    if (prefix === ":") return { value: Number(line), nextOffset: next };
    if (prefix === "-") throw new Error(`Redis error: ${line}`);

    if (prefix === "$") {
      const length = Number(line);
      if (length === -1) return { value: null, nextOffset: next };
      const end = next + length;
      if (this.buffer.length < end + 2) return null;
      return { value: this.buffer.toString("utf8", next, end), nextOffset: end + 2 };
    }

    if (prefix === "*") {
      const count = Number(line);
      if (count === -1) return { value: null, nextOffset: next };
      const values: RedisValue[] = [];
      let current = next;
      for (let i = 0; i < count; i += 1) {
        const item = this.parseValue(current);
        if (!item) return null;
        values.push(item.value);
        current = item.nextOffset;
      }
      return { value: values, nextOffset: current };
    }

    throw new Error(`Unsupported Redis response: ${prefix}`);
  }
}

async function withRedisAdmin<T>(url: string, fn: (redis: RedisAdminClient) => Promise<T>) {
  const redis = new RedisAdminClient(url);
  try {
    return await fn(redis);
  } finally {
    await redis.close();
  }
}

async function deleteRedisKeys(redis: RedisAdminClient, pattern: string): Promise<void> {
  let cursor = "0";
  do {
    const result = await redis.command("SCAN", cursor, "MATCH", pattern, "COUNT", "500");
    if (!Array.isArray(result) || typeof result[0] !== "string" || !Array.isArray(result[1])) {
      throw new Error("Unexpected Redis SCAN response");
    }
    cursor = result[0];
    const keys = result[1].filter((key): key is string => typeof key === "string");
    if (keys.length > 0) {
      await redis.command("UNLINK", ...keys);
    }
  } while (cursor !== "0");
}

function formatRecord(
  record: typeof projectDatabases.$inferSelect,
  password: string,
  pgInternal: string,
  pgExternal: string,
  mongoInternal: string,
  mongoExternal: string,
  redisInternal: string,
  redisExternal: string,
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
  if (record.type === "redis") {
    return {
      ...rest,
      password,
      keyPrefix: `${record.dbName}:`,
      uris: {
        internal: buildRedisUri(record.username, password, redisInternal),
        external: buildRedisUri(record.username, password, redisExternal),
      },
    };
  }
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
  redisAdminUrl,
  redisInternalHost,
  redisExternalHost,
}: ProjectDatabaseRouteDeps) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.post("/:projectId/databases", async (c) => {
    const projectId = c.req.param("projectId");
    const body = await c.req.json<{ type: "postgres" | "mongodb" | "redis" }>();
    const { type } = body;

    if (type !== "postgres" && type !== "mongodb" && type !== "redis") {
      return c.json(
        { error: { code: "INVALID_INPUT", message: "type must be postgres, mongodb, or redis" } },
        400,
      );
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
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
        {
          error: {
            code: "CONFLICT",
            message: `A ${type} database already exists for this project`,
          },
        },
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
    } else if (type === "mongodb") {
      const mongoDB = mongoAdminClient.db(identifier);
      await mongoDB.command({
        createUser: identifier,
        pwd: password,
        roles: [{ role: "dbOwner", db: identifier }],
      });
      await mongoDB.collection("_meta").insertOne({
        createdAt: new Date(),
        projectId,
        projectSlug: project.slug,
      });
    } else {
      await withRedisAdmin(redisAdminUrl, async (redis) => {
        await redis.command(
          "ACL",
          "SETUSER",
          identifier,
          "on",
          `>${password}`,
          `~${identifier}:*`,
          `&${identifier}:*`,
          "+@all",
          "-acl",
          "-config",
          "-debug",
          "-flushall",
          "-flushdb",
          "-module",
          "-monitor",
          "-replicaof",
          "-save",
          "-shutdown",
          "-slaveof",
        );
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
          redisInternalHost,
          redisExternalHost,
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
        redisInternalHost,
        redisExternalHost,
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
    } else if (record.type === "mongodb") {
      try {
        await mongoAdminClient.db(record.dbName).command({ dropUser: record.username });
      } catch {
        // user may already be gone
      }
      await mongoAdminClient.db(record.dbName).dropDatabase();
    } else {
      await withRedisAdmin(redisAdminUrl, async (redis) => {
        await deleteRedisKeys(redis, `${record.dbName}:*`);
        await redis.command("ACL", "DELUSER", record.username);
      });
    }

    await db.delete(projectDatabases).where(eq(projectDatabases.id, dbId));

    return c.json({ data: null });
  });

  return app;
}
