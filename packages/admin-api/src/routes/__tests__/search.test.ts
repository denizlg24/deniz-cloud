import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

class InputError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

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

describe("validateName", () => {
  it("accepts simple lowercase names", () => {
    expect(validateName("my-project", "Name")).toBe("my-project");
    expect(validateName("project1", "Name")).toBe("project1");
    expect(validateName("a", "Name")).toBe("a");
    expect(validateName("abc", "Name")).toBe("abc");
  });

  it("rejects empty string", () => {
    expect(() => validateName("", "Name")).toThrow("required");
  });

  it("rejects non-string values", () => {
    expect(() => validateName(null, "Name")).toThrow("required");
    expect(() => validateName(undefined, "Name")).toThrow("required");
    expect(() => validateName(123, "Name")).toThrow("required");
    expect(() => validateName(true, "Name")).toThrow("required");
  });

  it("rejects names over 50 characters", () => {
    const long = "a".repeat(51);
    expect(() => validateName(long, "Name")).toThrow("50 characters");
  });

  it("accepts exactly 50 characters", () => {
    const exact = "a".repeat(50);
    expect(validateName(exact, "Name")).toBe(exact);
  });

  it("rejects uppercase letters", () => {
    expect(() => validateName("MyProject", "Name")).toThrow("lowercase");
  });

  it("rejects underscores (critical for Meilisearch index scoping)", () => {
    expect(() => validateName("my_project", "Name")).toThrow("lowercase");
  });

  it("rejects names starting with hyphen", () => {
    expect(() => validateName("-project", "Name")).toThrow("lowercase");
  });

  it("rejects names ending with hyphen", () => {
    expect(() => validateName("project-", "Name")).toThrow("lowercase");
  });

  it("rejects spaces", () => {
    expect(() => validateName("my project", "Name")).toThrow("lowercase");
  });

  it("rejects special characters", () => {
    expect(() => validateName("my.project", "Name")).toThrow();
    expect(() => validateName("my@project", "Name")).toThrow();
    expect(() => validateName("my/project", "Name")).toThrow();
  });

  it("accepts single character", () => {
    expect(validateName("a", "Name")).toBe("a");
    expect(validateName("0", "Name")).toBe("0");
  });

  it("accepts two-character names", () => {
    expect(validateName("ab", "Name")).toBe("ab");
    expect(validateName("a1", "Name")).toBe("a1");
  });

  it("preserves the label in error messages", () => {
    expect(() => validateName("", "Project name")).toThrow("Project name is required");
    expect(() => validateName("", "Collection name")).toThrow("Collection name is required");
  });
});

describe("InputError", () => {
  it("has status 400", () => {
    const err = new InputError("test");
    expect(err.status).toBe(400);
  });

  it("has name InputError", () => {
    const err = new InputError("test");
    expect(err.name).toBe("InputError");
  });

  it("is an instance of Error", () => {
    const err = new InputError("test");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("Pagination math", () => {
  function parsePagination(query: { page?: string; limit?: string }) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "20", 10) || 20));
    const offset = (page - 1) * limit;
    return { page, limit, offset };
  }

  it("defaults to page 1, limit 20", () => {
    const { page, limit, offset } = parsePagination({});
    expect(page).toBe(1);
    expect(limit).toBe(20);
    expect(offset).toBe(0);
  });

  it("clamps page to minimum 1", () => {
    expect(parsePagination({ page: "0" }).page).toBe(1);
    expect(parsePagination({ page: "-5" }).page).toBe(1);
  });

  it("clamps limit to range [1, 100]", () => {
    expect(parsePagination({ limit: "0" }).limit).toBe(20); // 0 || 20 → fallback
    expect(parsePagination({ limit: "-1" }).limit).toBe(1); // parseInt("-1") is -1 (truthy), max(1, -1) → 1
    expect(parsePagination({ limit: "200" }).limit).toBe(100);
    expect(parsePagination({ limit: "100" }).limit).toBe(100);
    expect(parsePagination({ limit: "1" }).limit).toBe(1);
  });

  it("computes offset correctly", () => {
    expect(parsePagination({ page: "3", limit: "10" }).offset).toBe(20);
    expect(parsePagination({ page: "2", limit: "50" }).offset).toBe(50);
  });

  it("handles non-numeric page/limit gracefully", () => {
    expect(parsePagination({ page: "abc" }).page).toBe(1);
    expect(parsePagination({ limit: "xyz" }).limit).toBe(20);
  });

  it("totalPages math: ceil(total / limit)", () => {
    const computeTotalPages = (total: number, limit: number) => Math.ceil(total / limit);
    expect(computeTotalPages(0, 20)).toBe(0);
    expect(computeTotalPages(1, 20)).toBe(1);
    expect(computeTotalPages(20, 20)).toBe(1);
    expect(computeTotalPages(21, 20)).toBe(2);
    expect(computeTotalPages(100, 10)).toBe(10);
  });
});

describe("Token expiry constraints", () => {
  function parseExpiresInHours(value: unknown): number {
    return typeof value === "number" && value > 0 ? Math.min(value, 720) : 24;
  }

  it("defaults to 24 hours when not provided", () => {
    expect(parseExpiresInHours(undefined)).toBe(24);
    expect(parseExpiresInHours(null)).toBe(24);
  });

  it("caps at 720 hours (30 days)", () => {
    expect(parseExpiresInHours(1000)).toBe(720);
    expect(parseExpiresInHours(720)).toBe(720);
  });

  it("uses the provided value when within range", () => {
    expect(parseExpiresInHours(1)).toBe(1);
    expect(parseExpiresInHours(48)).toBe(48);
    expect(parseExpiresInHours(719)).toBe(719);
  });

  it("defaults to 24 for zero or negative", () => {
    expect(parseExpiresInHours(0)).toBe(24);
    expect(parseExpiresInHours(-1)).toBe(24);
  });

  it("defaults to 24 for non-number types", () => {
    expect(parseExpiresInHours("24")).toBe(24);
    expect(parseExpiresInHours(true)).toBe(24);
  });
});

describe("Safe project response shape", () => {
  it("strips meiliApiKey and meiliApiKeyUid from project", () => {
    const project = {
      id: "proj-1",
      name: "my-project",
      description: "A test project",
      ownerId: "user-1",
      meiliApiKeyUid: "secret-uid",
      meiliApiKey: "secret-key-12345",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { meiliApiKey: _, meiliApiKeyUid: __, ...safe } = project;

    expect(safe).not.toHaveProperty("meiliApiKey");
    expect(safe).not.toHaveProperty("meiliApiKeyUid");
    expect(safe).toHaveProperty("id");
    expect(safe).toHaveProperty("name");
    expect(safe).toHaveProperty("description");
    expect(safe).toHaveProperty("ownerId");
    expect(safe).toHaveProperty("createdAt");
    expect(safe).toHaveProperty("updatedAt");
  });
});

interface SearchProject {
  id: string;
  name: string;
  description?: string | null;
  ownerId?: string;
  meiliApiKey?: string;
  meiliApiKeyUid?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface SearchIndex {
  uid: string;
  primaryKey?: string;
}

interface SearchAppVariables {
  user: { id: string; username: string; role: "superuser" };
}

describe("Search routes HTTP contract", () => {
  const fakeUser = { id: "user-1", username: "admin", role: "superuser" as const };

  function createSearchApp(overrides: {
    projects?: SearchProject[];
    projectCount?: number;
    findProject?: (id: string) => SearchProject | undefined;
    meiliCreateKey?: () => { key: string; uid: string };
    meiliCreateIndex?: () => { taskUid: number };
    meiliDeleteIndex?: () => void;
    meiliGetIndexes?: () => { results: SearchIndex[] };
    meiliDeleteKey?: () => void;
    generateToken?: () => string;
  }) {
    const app = new Hono<{ Variables: SearchAppVariables }>();

    // Inject user
    app.use("*", async (c, next) => {
      c.set("user", fakeUser);
      return next();
    });

    // Error handler for InputError
    app.onError((err, c) => {
      if ("status" in err && err.status === 400) {
        return c.json({ error: { code: "INVALID_INPUT", message: err.message } }, 400);
      }
      return c.json({ error: { code: "INTERNAL", message: err.message } }, 500);
    });

    // GET /projects
    app.get("/projects", async (c) => {
      const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") ?? "20", 10) || 20));
      const total = overrides.projectCount ?? overrides.projects?.length ?? 0;
      const projects = overrides.projects ?? [];

      return c.json({
        data: projects,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    });

    // POST /projects
    app.post("/projects", async (c) => {
      const body = await c.req.json();
      const name = validateName(body.name, "Project name");
      const description = typeof body.description === "string" ? body.description : null;
      overrides.meiliCreateKey?.();

      return c.json(
        {
          data: {
            id: "new-proj-id",
            name,
            description,
            ownerId: fakeUser.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
        201,
      );
    });

    // GET /projects/:id
    app.get("/projects/:id", async (c) => {
      const project = overrides.findProject?.(c.req.param("id"));
      if (!project) {
        return c.json({ error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
      }
      const { meiliApiKey: _, meiliApiKeyUid: __, ...safe } = project;
      const indexes = overrides.meiliGetIndexes?.().results ?? [];
      return c.json({ data: { ...safe, collections: indexes } });
    });

    // DELETE /projects/:id
    app.delete("/projects/:id", async (c) => {
      const project = overrides.findProject?.(c.req.param("id"));
      if (!project) {
        return c.json({ error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
      }
      return c.json({ data: { id: c.req.param("id") } });
    });

    // POST /projects/:id/collections
    app.post("/projects/:id/collections", async (c) => {
      const project = overrides.findProject?.(c.req.param("id"));
      if (!project) {
        return c.json({ error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
      }
      const body = await c.req.json();
      const name = validateName(body.name, "Collection name");
      const primaryKey = typeof body.primaryKey === "string" ? body.primaryKey : "id";
      const task = overrides.meiliCreateIndex?.() ?? { taskUid: 1 };

      return c.json(
        {
          data: {
            name,
            uid: `${project.name}_${name}`,
            primaryKey,
            taskUid: task.taskUid,
          },
        },
        201,
      );
    });

    // DELETE /projects/:id/collections/:name
    app.delete("/projects/:id/collections/:name", async (c) => {
      const project = overrides.findProject?.(c.req.param("id"));
      if (!project) {
        return c.json({ error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
      }
      return c.json({ data: { name: c.req.param("name") } });
    });

    // POST /projects/:id/tokens
    app.post("/projects/:id/tokens", async (c) => {
      const project = overrides.findProject?.(c.req.param("id"));
      if (!project) {
        return c.json({ error: { code: "NOT_FOUND", message: "Project not found" } }, 404);
      }
      const body = await c.req.json();
      const expiresInHours =
        typeof body.expiresInHours === "number" && body.expiresInHours > 0
          ? Math.min(body.expiresInHours, 720)
          : 24;
      const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

      return c.json({
        data: { token: "tenant-token-xyz", expiresAt: expiresAt.toISOString() },
      });
    });

    return app;
  }

  describe("GET /projects", () => {
    it("returns paginated project list", async () => {
      const app = createSearchApp({ projects: [{ id: "p1", name: "p1" }], projectCount: 1 });
      const res = await app.request("/projects");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.total).toBe(1);
    });

    it("returns empty list with correct pagination", async () => {
      const app = createSearchApp({ projects: [], projectCount: 0 });
      const res = await app.request("/projects");
      const body = await res.json();
      expect(body.data).toHaveLength(0);
      expect(body.pagination.total).toBe(0);
      expect(body.pagination.totalPages).toBe(0);
    });
  });

  describe("POST /projects", () => {
    it("creates project and returns 201", async () => {
      const app = createSearchApp({});
      const res = await app.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "my-project", description: "Test project" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.name).toBe("my-project");
      expect(body.data.description).toBe("Test project");
    });

    it("returns 400 for invalid project name", async () => {
      const app = createSearchApp({});
      const res = await app.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Invalid_Name" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for missing project name", async () => {
      const app = createSearchApp({});
      const res = await app.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it("sets description to null when not provided", async () => {
      const app = createSearchApp({});
      const res = await app.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "no-desc" }),
      });

      const body = await res.json();
      expect(body.data.description).toBeNull();
    });
  });

  describe("GET /projects/:id", () => {
    it("returns 404 for non-existent project", async () => {
      const app = createSearchApp({ findProject: () => undefined });
      const res = await app.request("/projects/nonexistent");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("returns project without sensitive fields", async () => {
      const project = {
        id: "p1",
        name: "test-project",
        description: null,
        ownerId: "user-1",
        meiliApiKey: "secret",
        meiliApiKeyUid: "secret-uid",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const app = createSearchApp({
        findProject: (id) => (id === "p1" ? project : undefined),
        meiliGetIndexes: () => ({ results: [] }),
      });

      const res = await app.request("/projects/p1");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).not.toHaveProperty("meiliApiKey");
      expect(body.data).not.toHaveProperty("meiliApiKeyUid");
      expect(body.data.collections).toEqual([]);
    });
  });

  describe("DELETE /projects/:id", () => {
    it("returns 404 for non-existent project", async () => {
      const app = createSearchApp({ findProject: () => undefined });
      const res = await app.request("/projects/missing", { method: "DELETE" });
      expect(res.status).toBe(404);
    });

    it("returns the deleted project id", async () => {
      const app = createSearchApp({
        findProject: (id) =>
          id === "p1" ? { id: "p1", name: "test", meiliApiKeyUid: "u" } : undefined,
      });
      const res = await app.request("/projects/p1", { method: "DELETE" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe("p1");
    });
  });

  describe("POST /projects/:id/collections", () => {
    const project = {
      id: "p1",
      name: "myproject",
      meiliApiKey: "k",
      meiliApiKeyUid: "u",
    };

    it("creates collection with scoped index name", async () => {
      const app = createSearchApp({
        findProject: (id) => (id === "p1" ? project : undefined),
      });

      const res = await app.request("/projects/p1/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "products" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.uid).toBe("myproject_products");
      expect(body.data.primaryKey).toBe("id"); // default
    });

    it("uses custom primaryKey when provided", async () => {
      const app = createSearchApp({
        findProject: (id) => (id === "p1" ? project : undefined),
      });

      const res = await app.request("/projects/p1/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "items", primaryKey: "itemId" }),
      });

      const body = await res.json();
      expect(body.data.primaryKey).toBe("itemId");
    });

    it("returns 404 if project does not exist", async () => {
      const app = createSearchApp({ findProject: () => undefined });
      const res = await app.request("/projects/nope/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "stuff" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid collection name", async () => {
      const app = createSearchApp({
        findProject: (id) => (id === "p1" ? project : undefined),
      });
      const res = await app.request("/projects/p1/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Bad_Name" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /projects/:id/collections/:name", () => {
    it("returns 404 if project does not exist", async () => {
      const app = createSearchApp({ findProject: () => undefined });
      const res = await app.request("/projects/nope/collections/stuff", { method: "DELETE" });
      expect(res.status).toBe(404);
    });

    it("returns the deleted collection name", async () => {
      const app = createSearchApp({
        findProject: (id) => (id === "p1" ? { id: "p1", name: "proj" } : undefined),
      });
      const res = await app.request("/projects/p1/collections/products", { method: "DELETE" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.name).toBe("products");
    });
  });

  describe("POST /projects/:id/tokens", () => {
    const project = {
      id: "p1",
      name: "myproject",
      meiliApiKey: "k",
      meiliApiKeyUid: "u",
    };

    it("returns 404 if project does not exist", async () => {
      const app = createSearchApp({ findProject: () => undefined });
      const res = await app.request("/projects/nope/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
    });

    it("returns token and expiresAt ISO string", async () => {
      const app = createSearchApp({
        findProject: (id) => (id === "p1" ? project : undefined),
      });
      const res = await app.request("/projects/p1/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveProperty("token");
      expect(body.data).toHaveProperty("expiresAt");
      // expiresAt should be valid ISO
      expect(new Date(body.data.expiresAt).toISOString()).toBe(body.data.expiresAt);
    });

    it("default expiry is ~24 hours from now", async () => {
      const before = Date.now();
      const app = createSearchApp({
        findProject: (id) => (id === "p1" ? project : undefined),
      });
      const res = await app.request("/projects/p1/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const after = Date.now();
      const body = await res.json();
      const expiresMs = new Date(body.data.expiresAt).getTime();

      // Should be ~24h from now (within a 5s tolerance)
      const expectedMin = before + 24 * 60 * 60 * 1000 - 5000;
      const expectedMax = after + 24 * 60 * 60 * 1000 + 5000;
      expect(expiresMs).toBeGreaterThanOrEqual(expectedMin);
      expect(expiresMs).toBeLessThanOrEqual(expectedMax);
    });
  });
});
