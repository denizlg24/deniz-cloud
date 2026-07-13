import { type Database, projectDatabases } from "@deniz-cloud/shared/db";
import type { AuthVariables } from "@deniz-cloud/shared/middleware";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Document, MongoClient } from "mongodb";

interface ProjectVectorIndexRouteDeps {
  db: Database;
  mongoAdminClient: MongoClient;
  mongotHealthUrl: string;
  maxIndexesPerProject: number;
}

const RESOURCE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/;
const FIELD_PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const SIMILARITIES = new Set(["cosine", "euclidean", "dotProduct"]);
const QUANTIZATIONS = new Set(["none", "scalar", "binary"]);

export interface VectorIndexInput {
  collection: string;
  name: string;
  path: string;
  numDimensions: number;
  similarity: "cosine" | "euclidean" | "dotProduct";
  quantization: "none" | "scalar" | "binary";
  filterPaths: string[];
}

function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

function validateResourceName(value: unknown, label: string): string {
  if (typeof value !== "string" || !RESOURCE_NAME_RE.test(value) || value.includes("$")) {
    invalid(
      `${label} must start with a letter or underscore and contain only letters, numbers, ., _, or -`,
    );
  }
  return value;
}

function validateFieldPath(value: unknown, label: string): string {
  if (typeof value !== "string" || !FIELD_PATH_RE.test(value)) {
    invalid(`${label} must be a dotted MongoDB field path`);
  }
  return value;
}

export function parseVectorIndexInput(body: unknown): VectorIndexInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    invalid("Request body must be an object");
  }
  const input = body as Record<string, unknown>;
  const collection = validateResourceName(input.collection, "collection");
  const name = validateResourceName(input.name, "index name");
  const path = validateFieldPath(input.path, "path");
  const numDimensions = input.numDimensions;
  if (
    !Number.isInteger(numDimensions) ||
    (numDimensions as number) < 1 ||
    (numDimensions as number) > 4096
  ) {
    invalid("numDimensions must be an integer between 1 and 4096");
  }
  if (typeof input.similarity !== "string" || !SIMILARITIES.has(input.similarity)) {
    invalid("similarity must be cosine, euclidean, or dotProduct");
  }
  const quantization = input.quantization ?? "none";
  if (typeof quantization !== "string" || !QUANTIZATIONS.has(quantization)) {
    invalid("quantization must be none, scalar, or binary");
  }
  const rawFilters = input.filterPaths ?? [];
  if (!Array.isArray(rawFilters) || rawFilters.length > 5) {
    invalid("filterPaths must contain at most 5 paths");
  }
  const filterPaths = [
    ...new Set(rawFilters.map((filter) => validateFieldPath(filter, "filter path"))),
  ];
  if (filterPaths.includes(path)) {
    invalid("The vector path cannot also be a filter path");
  }

  return {
    collection,
    name,
    path,
    numDimensions: numDimensions as number,
    similarity: input.similarity as VectorIndexInput["similarity"],
    quantization: quantization as VectorIndexInput["quantization"],
    filterPaths,
  };
}

function vectorFieldFrom(index: Document): Document | undefined {
  const definition = index.latestDefinition ?? index.definition;
  if (!definition || !Array.isArray(definition.fields)) return undefined;
  return definition.fields.find((field: Document) => field?.type === "vector");
}

export function normalizeVectorIndex(collection: string, index: Document) {
  const field = vectorFieldFrom(index);
  if (!field) return null;
  const definition = index.latestDefinition ?? index.definition;
  const filterPaths = Array.isArray(definition?.fields)
    ? definition.fields
        .filter((item: Document) => item?.type === "filter" && typeof item.path === "string")
        .map((item: Document) => item.path as string)
    : [];
  return {
    collection,
    name: String(index.name),
    status: typeof index.status === "string" ? index.status : "UNKNOWN",
    queryable: index.queryable === true,
    path: String(field.path),
    numDimensions: Number(field.numDimensions),
    similarity: String(field.similarity),
    quantization: typeof field.quantization === "string" ? field.quantization : "none",
    filterPaths,
  };
}

interface MongotHealth {
  status: "ready" | "unavailable";
  message?: string;
}

async function getMongotHealth(baseUrl: string): Promise<MongotHealth> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/ready`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok
      ? { status: "ready" }
      : { status: "unavailable", message: `mongot returned HTTP ${response.status}` };
  } catch {
    return { status: "unavailable", message: "mongot is not reachable" };
  }
}

async function getProjectMongoDatabase(db: Database, projectId: string): Promise<string | null> {
  const [record] = await db
    .select({ dbName: projectDatabases.dbName })
    .from(projectDatabases)
    .where(and(eq(projectDatabases.projectId, projectId), eq(projectDatabases.type, "mongodb")))
    .limit(1);
  return record?.dbName ?? null;
}

async function listVectorIndexes(mongo: MongoClient, dbName: string, collections: string[]) {
  const indexes = await Promise.all(
    collections.map(async (collection) => {
      const raw = await mongo.db(dbName).collection(collection).listSearchIndexes().toArray();
      return raw
        .map((index) => normalizeVectorIndex(collection, index))
        .filter((index): index is NonNullable<typeof index> => index !== null);
    }),
  );
  return indexes.flat();
}

export function projectVectorIndexRoutes({
  db,
  mongoAdminClient,
  mongotHealthUrl,
  maxIndexesPerProject,
}: ProjectVectorIndexRouteDeps) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/:projectId/vector-indexes", async (c) => {
    const dbName = await getProjectMongoDatabase(db, c.req.param("projectId"));
    if (!dbName) {
      return c.json(
        { error: { code: "MONGODB_NOT_PROVISIONED", message: "Project has no MongoDB database" } },
        404,
      );
    }

    const collections = (
      await mongoAdminClient.db(dbName).listCollections({}, { nameOnly: true }).toArray()
    )
      .map((collection) => collection.name)
      .filter((name) => !name.startsWith("system."));
    const mongot: MongotHealth = await getMongotHealth(mongotHealthUrl);
    let indexes: Awaited<ReturnType<typeof listVectorIndexes>> = [];
    if (mongot.status === "ready") {
      try {
        indexes = await listVectorIndexes(mongoAdminClient, dbName, collections);
      } catch (error) {
        console.error(`[vector-search] Failed to list indexes for ${dbName}:`, error);
        mongot.status = "unavailable";
        mongot.message = "Vector index management is temporarily unavailable";
      }
    }

    return c.json({
      data: { database: dbName, collections, indexes, mongot, maxIndexes: maxIndexesPerProject },
    });
  });

  app.post("/:projectId/vector-indexes", async (c) => {
    const projectId = c.req.param("projectId");
    const dbName = await getProjectMongoDatabase(db, projectId);
    if (!dbName) {
      return c.json(
        { error: { code: "MONGODB_NOT_PROVISIONED", message: "Project has no MongoDB database" } },
        404,
      );
    }
    const mongot = await getMongotHealth(mongotHealthUrl);
    if (mongot.status !== "ready") {
      return c.json({ error: { code: "MONGOT_UNAVAILABLE", message: mongot.message } }, 503);
    }

    const input = parseVectorIndexInput(await c.req.json());
    const mongoDb = mongoAdminClient.db(dbName);
    const collectionExists = await mongoDb
      .listCollections({ name: input.collection }, { nameOnly: true })
      .hasNext();
    if (!collectionExists) {
      return c.json(
        { error: { code: "COLLECTION_NOT_FOUND", message: "Collection does not exist" } },
        404,
      );
    }

    const collections = (await mongoDb.listCollections({}, { nameOnly: true }).toArray())
      .map((collection) => collection.name)
      .filter((name) => !name.startsWith("system."));
    let existing: Awaited<ReturnType<typeof listVectorIndexes>>;
    try {
      existing = await listVectorIndexes(mongoAdminClient, dbName, collections);
    } catch (error) {
      console.error(`[vector-search] Failed to inspect indexes for ${dbName}:`, error);
      return c.json(
        {
          error: {
            code: "MONGOT_UNAVAILABLE",
            message: "Vector index management is temporarily unavailable",
          },
        },
        503,
      );
    }
    if (existing.length >= maxIndexesPerProject) {
      return c.json(
        {
          error: {
            code: "INDEX_QUOTA_REACHED",
            message: `Projects may have at most ${maxIndexesPerProject} vector indexes`,
          },
        },
        409,
      );
    }
    if (
      existing.some((index) => index.collection === input.collection && index.name === input.name)
    ) {
      return c.json(
        {
          error: { code: "INDEX_EXISTS", message: "A vector index with this name already exists" },
        },
        409,
      );
    }

    const fields: Document[] = [
      {
        type: "vector",
        path: input.path,
        numDimensions: input.numDimensions,
        similarity: input.similarity,
        ...(input.quantization === "none" ? {} : { quantization: input.quantization }),
      },
      ...input.filterPaths.map((path) => ({ type: "filter", path })),
    ];
    try {
      const name = await mongoDb.collection(input.collection).createSearchIndex({
        name: input.name,
        type: "vectorSearch",
        definition: { fields },
      });
      return c.json({ data: { collection: input.collection, name, status: "BUILDING" } }, 202);
    } catch (error) {
      console.error(
        `[vector-search] Failed to create ${dbName}.${input.collection}.${input.name}:`,
        error,
      );
      return c.json(
        {
          error: {
            code: "INDEX_CREATE_FAILED",
            message: "MongoDB could not create the vector index",
          },
        },
        502,
      );
    }
  });

  app.delete("/:projectId/vector-indexes/:collection/:indexName", async (c) => {
    const dbName = await getProjectMongoDatabase(db, c.req.param("projectId"));
    if (!dbName) {
      return c.json(
        { error: { code: "MONGODB_NOT_PROVISIONED", message: "Project has no MongoDB database" } },
        404,
      );
    }
    const collection = validateResourceName(c.req.param("collection"), "collection");
    const indexName = validateResourceName(c.req.param("indexName"), "index name");
    try {
      await mongoAdminClient.db(dbName).collection(collection).dropSearchIndex(indexName);
      return c.json({ data: { collection, name: indexName, dropped: true } });
    } catch (error) {
      console.error(`[vector-search] Failed to drop ${dbName}.${collection}.${indexName}:`, error);
      return c.json(
        {
          error: { code: "INDEX_DROP_FAILED", message: "MongoDB could not drop the vector index" },
        },
        502,
      );
    }
  });

  return app;
}
