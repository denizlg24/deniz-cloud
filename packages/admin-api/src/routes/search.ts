import type { Database } from "@deniz-cloud/shared/db";
import { searchProjects } from "@deniz-cloud/shared/db/schema";
import type { AuthVariables } from "@deniz-cloud/shared/middleware";
import {
  createProjectIndex,
  createProjectSearchKey,
  deleteAllProjectIndexes,
  deleteProjectIndex,
  deleteProjectSearchKey,
  generateProjectToken,
  getProjectIndexes,
  parseScopedIndexName,
  scopedIndexName,
} from "@deniz-cloud/shared/search";
import { count, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { MeiliSearch } from "meilisearch";

const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function validateName(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) {
    throw new InputError(`${label} is required`);
  }
  if (value.length > 50) {
    throw new InputError(`${label} must be 50 characters or fewer`);
  }
  if (!NAME_PATTERN.test(value)) {
    throw new InputError(`${label} must be lowercase alphanumeric with hyphens (no underscores)`);
  }
  return value;
}

class InputError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

interface SearchRouteDeps {
  db: Database;
  meiliClient: MeiliSearch;
}

export function searchRoutes({ db, meiliClient }: SearchRouteDeps) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/projects", async (c) => {
    const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") ?? "20", 10) || 20));
    const offset = (page - 1) * limit;

    const [projects, countResult] = await Promise.all([
      db
        .select({
          id: searchProjects.id,
          name: searchProjects.name,
          description: searchProjects.description,
          ownerId: searchProjects.ownerId,
          createdAt: searchProjects.createdAt,
          updatedAt: searchProjects.updatedAt,
        })
        .from(searchProjects)
        .orderBy(desc(searchProjects.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: count() }).from(searchProjects),
    ]);

    const total = countResult[0]?.count ?? 0;

    return c.json({
      data: projects,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  });

  app.post("/projects", async (c) => {
    const body = await c.req.json();
    const name = validateName(body.name, "Project name");
    const description = typeof body.description === "string" ? body.description : null;
    const user = c.get("user");

    const { key, uid } = await createProjectSearchKey(meiliClient, name);

    const [project] = await db
      .insert(searchProjects)
      .values({
        name,
        description,
        ownerId: user.id,
        meiliApiKeyUid: uid,
        meiliApiKey: key,
      })
      .returning();

    if (!project) throw new Error("Failed to create project");

    const { meiliApiKey: _, meiliApiKeyUid: __, ...safe } = project;
    return c.json({ data: safe }, 201);
  });

  app.get("/projects/:id", async (c) => {
    const project = await db.query.searchProjects.findFirst({
      where: eq(searchProjects.id, c.req.param("id")),
    });
    if (!project) {
      return c.json({ error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
    }

    const indexes = await getProjectIndexes(meiliClient, project.name);
    const collections = indexes.map((idx) => ({
      name: parseScopedIndexName(idx.uid)?.collection ?? idx.uid,
      uid: idx.uid,
      primaryKey: idx.primaryKey,
      createdAt: idx.createdAt,
      updatedAt: idx.updatedAt,
    }));

    const { meiliApiKey: _, meiliApiKeyUid: __, ...safe } = project;
    return c.json({ data: { ...safe, collections } });
  });

  app.delete("/projects/:id", async (c) => {
    const projectId = c.req.param("id");

    const project = await db.query.searchProjects.findFirst({
      where: eq(searchProjects.id, projectId),
    });
    if (!project) {
      return c.json({ error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
    }

    await deleteAllProjectIndexes(meiliClient, project.name);

    try {
      await deleteProjectSearchKey(meiliClient, project.meiliApiKeyUid);
    } catch {
      // Key may already be deleted
    }

    await db.delete(searchProjects).where(eq(searchProjects.id, projectId));

    return c.json({ data: { id: projectId } });
  });

  app.post("/projects/:id/collections", async (c) => {
    const body = await c.req.json();
    const name = validateName(body.name, "Collection name");
    const primaryKey = typeof body.primaryKey === "string" ? body.primaryKey : "id";

    const project = await db.query.searchProjects.findFirst({
      where: eq(searchProjects.id, c.req.param("id")),
    });
    if (!project) {
      return c.json({ error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
    }

    const task = await createProjectIndex(meiliClient, project.name, name, primaryKey);

    return c.json(
      {
        data: {
          name,
          uid: scopedIndexName(project.name, name),
          primaryKey,
          taskUid: task.taskUid,
        },
      },
      201,
    );
  });

  app.delete("/projects/:id/collections/:name", async (c) => {
    const project = await db.query.searchProjects.findFirst({
      where: eq(searchProjects.id, c.req.param("id")),
    });
    if (!project) {
      return c.json({ error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
    }

    const collectionName = c.req.param("name");
    await deleteProjectIndex(meiliClient, project.name, collectionName);

    return c.json({ data: { name: collectionName } });
  });

  app.post("/projects/:id/tokens", async (c) => {
    const project = await db.query.searchProjects.findFirst({
      where: eq(searchProjects.id, c.req.param("id")),
    });
    if (!project) {
      return c.json({ error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
    }

    const body = await c.req.json();
    const expiresInHours =
      typeof body.expiresInHours === "number" && body.expiresInHours > 0
        ? Math.min(body.expiresInHours, 720) // max 30 days
        : 24;

    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    const token = await generateProjectToken({
      apiKey: project.meiliApiKey,
      apiKeyUid: project.meiliApiKeyUid,
      projectName: project.name,
      expiresAt,
    });

    return c.json({
      data: { token, expiresAt: expiresAt.toISOString() },
    });
  });

  return app;
}
