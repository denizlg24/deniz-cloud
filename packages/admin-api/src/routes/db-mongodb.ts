import type { AuthVariables } from "@deniz-cloud/shared/middleware";
import { Hono } from "hono";
import type { MongoClient } from "mongodb";

interface MongoDbRouteDeps {
  mongoClient: MongoClient;
}

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/;
const PROTECTED_DBS = new Set(["admin", "config", "local"]);

function validateName(name: string, label: string): void {
  if (!NAME_RE.test(name) || name.includes("$") || name.includes("\0")) {
    throw Object.assign(new Error(`Invalid ${label}: must match ${NAME_RE.source}`), {
      status: 400,
    });
  }
}

export function mongoDbRoutes({ mongoClient }: MongoDbRouteDeps) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/databases", async (c) => {
    const result = await mongoClient.db().admin().listDatabases();
    const databases = result.databases.map((db) => ({
      name: db.name,
      sizeBytes: db.sizeOnDisk ?? 0,
      empty: db.empty ?? false,
      isProtected: PROTECTED_DBS.has(db.name),
    }));
    return c.json({ data: databases });
  });

  app.post("/databases", async (c) => {
    const body = await c.req.json<{ name: string }>();
    validateName(body.name, "database name");

    await mongoClient.db(body.name).createCollection("_init");
    return c.json({ data: { name: body.name } }, 201);
  });

  app.delete("/databases/:name", async (c) => {
    const name = c.req.param("name");
    validateName(name, "database name");

    if (PROTECTED_DBS.has(name)) {
      return c.json(
        { error: { code: "PROTECTED_DATABASE", message: `Database "${name}" cannot be dropped` } },
        403,
      );
    }

    await mongoClient.db(name).dropDatabase();
    return c.json({ data: { dropped: name } });
  });

  app.get("/databases/:name/collections", async (c) => {
    const name = c.req.param("name");
    validateName(name, "database name");

    const db = mongoClient.db(name);
    const collections = await db.listCollections().toArray();

    const result = await Promise.all(
      collections.map(async (col) => {
        if (col.name.startsWith("system.")) {
          return {
            name: col.name,
            type: col.type,
            documentCount: 0,
            sizeBytes: 0,
            indexCount: 0,
          };
        }
        try {
          const coll = db.collection(col.name);
          const [docCount, indexes] = await Promise.all([
            coll.estimatedDocumentCount().catch(() => 0),
            coll.indexes().catch(() => []),
          ]);
          return {
            name: col.name,
            type: col.type,
            documentCount: docCount,
            sizeBytes: 0,
            indexCount: indexes.length,
          };
        } catch {
          return {
            name: col.name,
            type: col.type,
            documentCount: 0,
            sizeBytes: 0,
            indexCount: 0,
          };
        }
      }),
    );

    return c.json({ data: result });
  });

  app.post("/databases/:name/collections", async (c) => {
    const name = c.req.param("name");
    validateName(name, "database name");

    const body = await c.req.json<{
      name: string;
      capped?: boolean;
      size?: number;
      max?: number;
    }>();
    validateName(body.name, "collection name");

    const options: { capped?: boolean; size?: number; max?: number } = {};
    if (body.capped) {
      options.capped = true;
      if (body.size) options.size = body.size;
      if (body.max) options.max = body.max;
    }

    await mongoClient.db(name).createCollection(body.name, options);
    return c.json({ data: { name: body.name } }, 201);
  });

  app.delete("/databases/:name/collections/:collName", async (c) => {
    const name = c.req.param("name");
    const collName = c.req.param("collName");
    validateName(name, "database name");
    validateName(collName, "collection name");

    await mongoClient.db(name).dropCollection(collName);
    return c.json({ data: { dropped: collName } });
  });

  app.get("/databases/:name/collections/:collName/indexes", async (c) => {
    const name = c.req.param("name");
    const collName = c.req.param("collName");
    validateName(name, "database name");
    validateName(collName, "collection name");

    const indexes = await mongoClient.db(name).collection(collName).indexes();
    return c.json({
      data: indexes.map((idx) => ({
        name: idx.name,
        key: idx.key,
        unique: idx.unique ?? false,
        sparse: idx.sparse ?? false,
      })),
    });
  });

  app.post("/databases/:name/collections/:collName/indexes", async (c) => {
    const name = c.req.param("name");
    const collName = c.req.param("collName");
    validateName(name, "database name");
    validateName(collName, "collection name");

    const body = await c.req.json<{
      fields: Array<{ name: string; direction: 1 | -1 }>;
      unique?: boolean;
      sparse?: boolean;
      name?: string;
    }>();

    if (!body.fields || body.fields.length === 0) {
      throw Object.assign(new Error("At least one field is required"), { status: 400 });
    }

    const keys: Record<string, 1 | -1> = {};
    for (const field of body.fields) {
      keys[field.name] = field.direction;
    }

    const options: { unique?: boolean; sparse?: boolean; name?: string } = {};
    if (body.unique) options.unique = true;
    if (body.sparse) options.sparse = true;
    if (body.name) options.name = body.name;

    const indexName = await mongoClient.db(name).collection(collName).createIndex(keys, options);
    return c.json({ data: { name: indexName } }, 201);
  });

  app.delete("/databases/:name/collections/:collName/indexes/:indexName", async (c) => {
    const name = c.req.param("name");
    const collName = c.req.param("collName");
    const indexName = c.req.param("indexName");
    validateName(name, "database name");
    validateName(collName, "collection name");

    if (indexName === "_id_") {
      return c.json(
        { error: { code: "PROTECTED_INDEX", message: "The _id_ index cannot be dropped" } },
        403,
      );
    }

    await mongoClient.db(name).collection(collName).dropIndex(indexName);
    return c.json({ data: { dropped: indexName } });
  });

  app.get("/databases/:name/collections/:collName/sample", async (c) => {
    const name = c.req.param("name");
    const collName = c.req.param("collName");
    validateName(name, "database name");
    validateName(collName, "collection name");

    const docs = await mongoClient.db(name).collection(collName).find().limit(5).toArray();
    return c.json({ data: docs });
  });

  app.post("/databases/:name/collections/:collName/find", async (c) => {
    const name = c.req.param("name");
    const collName = c.req.param("collName");
    validateName(name, "database name");
    validateName(collName, "collection name");

    const body = await c.req.json<{
      filter?: string;
      sort?: string;
      limit?: number;
      skip?: number;
    }>();

    const limit = Math.min(Math.max(body.limit ?? 20, 1), 100);
    const skip = Math.max(body.skip ?? 0, 0);

    let filter: Record<string, unknown> = {};
    if (body.filter?.trim()) {
      try {
        filter = JSON.parse(body.filter) as Record<string, unknown>;
      } catch {
        return c.json(
          { error: { code: "INVALID_FILTER", message: "Filter must be valid JSON" } },
          400,
        );
      }
    }

    let sort: Record<string, 1 | -1> | undefined;
    if (body.sort?.trim()) {
      try {
        sort = JSON.parse(body.sort) as Record<string, 1 | -1>;
      } catch {
        return c.json({ error: { code: "INVALID_SORT", message: "Sort must be valid JSON" } }, 400);
      }
    }

    const startTime = performance.now();

    try {
      const collection = mongoClient.db(name).collection(collName);
      let cursor = collection.find(filter).skip(skip).limit(limit);
      if (sort) cursor = cursor.sort(sort);

      const [docs, totalCount] = await Promise.all([
        cursor.toArray(),
        collection.countDocuments(filter),
      ]);

      const durationMs = Math.round(performance.now() - startTime);

      return c.json({
        data: {
          documents: docs,
          totalCount,
          durationMs,
        },
      });
    } catch (err) {
      const durationMs = Math.round(performance.now() - startTime);
      const message = err instanceof Error ? err.message : "Query execution failed";
      return c.json(
        {
          error: { code: "QUERY_ERROR", message },
          data: { durationMs },
        },
        400,
      );
    }
  });

  return app;
}
