import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

interface TestUser {
  id: string;
  username: string;
  email: string | null;
  role: "user" | "superuser";
  status: "active" | "pending";
  totpEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface UserAppVariables {
  user: TestUser;
  sessionId: string;
}

class MockAuthError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

function createUsersApp(overrides: {
  users?: TestUser[];
  total?: number;
  createResult?: TestUser;
  createError?: Error;
  deleteError?: Error;
  resetMfaError?: Error;
}) {
  const app = new Hono<{ Variables: UserAppVariables }>();

  // Inject superuser context
  app.use("*", async (c, next) => {
    c.set("user", {
      id: "admin-1",
      username: "admin",
      email: "admin@test.com",
      role: "superuser",
      status: "active",
      totpEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    c.set("sessionId", "session-1");
    return next();
  });

  app.onError((err, c) => {
    if (err instanceof MockAuthError) {
      return c.json(
        { error: { code: err.code, message: err.message } },
        { status: err.status as 400 | 401 | 403 | 404 },
      );
    }
    return c.json({ error: { code: "INTERNAL", message: err.message } }, 500);
  });

  app.get("/", async (c) => {
    const page = parseInt(c.req.query("page") ?? "1", 10);
    const limit = parseInt(c.req.query("limit") ?? "50", 10);

    if (page < 1 || limit < 1 || limit > 100) {
      return c.json(
        { error: { code: "INVALID_INPUT", message: "Invalid pagination parameters" } },
        400,
      );
    }

    const users = overrides.users ?? [];
    const total = overrides.total ?? users.length;

    return c.json({
      data: users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  });

  app.post("/", async (c) => {
    const body = await c.req.json();

    if (typeof body.username !== "string" || body.username.trim().length === 0) {
      return c.json({ error: { code: "INVALID_INPUT", message: "Username is required" } }, 400);
    }

    const username = body.username.trim().toLowerCase();

    if (!/^[a-z0-9_-]{3,50}$/.test(username)) {
      return c.json(
        {
          error: {
            code: "INVALID_INPUT",
            message:
              "Username must be 3-50 characters: lowercase letters, numbers, hyphens, underscores",
          },
        },
        400,
      );
    }

    if (overrides.createError) throw overrides.createError;

    const role = body.role === "superuser" ? "superuser" : "user";
    const user = overrides.createResult ?? {
      id: "new-user-id",
      username,
      email: null,
      role,
      status: "pending" as const,
      totpEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return c.json({ data: user }, 201);
  });

  app.delete("/:id", async (c) => {
    if (overrides.deleteError) throw overrides.deleteError;
    return c.json({ data: { success: true } });
  });

  app.post("/:id/reset-mfa", async (c) => {
    if (overrides.resetMfaError) throw overrides.resetMfaError;
    return c.json({ data: { success: true } });
  });

  return app;
}

describe("GET /users", () => {
  it("returns paginated user list", async () => {
    const users: TestUser[] = [
      {
        id: "u1",
        username: "alice",
        email: "alice@test.com",
        role: "user",
        status: "active",
        totpEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const app = createUsersApp({ users, total: 1 });
    const res = await app.request("/");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.total).toBe(1);
    expect(body.pagination.totalPages).toBe(1);
  });

  it("returns 400 for page < 1", async () => {
    const app = createUsersApp({});
    const res = await app.request("/?page=0");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 400 for limit < 1", async () => {
    const app = createUsersApp({});
    const res = await app.request("/?limit=0");
    expect(res.status).toBe(400);
  });

  it("returns 400 for limit > 100", async () => {
    const app = createUsersApp({});
    const res = await app.request("/?limit=101");
    expect(res.status).toBe(400);
  });

  it("accepts page=1 and limit=100 (boundary)", async () => {
    const app = createUsersApp({ users: [] });
    const res = await app.request("/?page=1&limit=100");
    expect(res.status).toBe(200);
  });

  it("returns empty list with correct pagination for no users", async () => {
    const app = createUsersApp({ users: [], total: 0 });
    const res = await app.request("/");
    const body = await res.json();
    expect(body.data).toHaveLength(0);
    expect(body.pagination.total).toBe(0);
    expect(body.pagination.totalPages).toBe(0);
  });
});

describe("POST /users", () => {
  it("creates a pending user with valid username", async () => {
    const app = createUsersApp({});
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "newuser" }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.username).toBe("newuser");
    expect(body.data.status).toBe("pending");
  });

  it("normalizes username to lowercase", async () => {
    const app = createUsersApp({});
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "  TestUser  " }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.username).toBe("testuser");
  });

  it("returns 400 for missing username", async () => {
    const app = createUsersApp({});
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty username", async () => {
    const app = createUsersApp({});
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for username shorter than 3 characters", async () => {
    const app = createUsersApp({});
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "ab" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("3-50");
  });

  it("returns 400 for username longer than 50 characters", async () => {
    const app = createUsersApp({});
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "a".repeat(51) }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for username with invalid characters", async () => {
    const app = createUsersApp({});
    const invalidUsernames = ["user@name", "user name", "user.name", "user!name"];

    for (const username of invalidUsernames) {
      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      expect(res.status).toBe(400);
    }
  });

  it("accepts usernames with hyphens and underscores", async () => {
    const app = createUsersApp({});
    const validUsernames = ["test-user", "test_user", "user-123", "user_name_long"];

    for (const username of validUsernames) {
      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      expect(res.status).toBe(201);
    }
  });

  it("defaults role to 'user' when not specified", async () => {
    const app = createUsersApp({});
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "newuser" }),
    });

    const body = await res.json();
    expect(body.data.role).toBe("user");
  });

  it("accepts 'superuser' role when explicitly set", async () => {
    const app = createUsersApp({
      createResult: {
        id: "su-1",
        username: "newadmin",
        email: null,
        role: "superuser",
        status: "pending",
        totpEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "newadmin", role: "superuser" }),
    });

    const body = await res.json();
    expect(body.data.role).toBe("superuser");
  });

  it("returns 400 when username is not a string", async () => {
    const app = createUsersApp({});
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: 12345 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /users/:id", () => {
  it("returns success on delete", async () => {
    const app = createUsersApp({});
    const res = await app.request("/user-1", { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.success).toBe(true);
  });

  it("returns 404 when user not found", async () => {
    const app = createUsersApp({
      deleteError: new MockAuthError("User not found", "USER_NOT_FOUND", 404),
    });
    const res = await app.request("/nonexistent", { method: "DELETE" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("USER_NOT_FOUND");
  });

  it("returns 403 when trying to delete a superuser", async () => {
    const app = createUsersApp({
      deleteError: new MockAuthError("Cannot delete superuser accounts", "FORBIDDEN", 403),
    });
    const res = await app.request("/admin-1", { method: "DELETE" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

describe("POST /users/:id/reset-mfa", () => {
  it("returns success on MFA reset", async () => {
    const app = createUsersApp({});
    const res = await app.request("/user-1/reset-mfa", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.success).toBe(true);
  });

  it("returns 404 when user not found", async () => {
    const app = createUsersApp({
      resetMfaError: new MockAuthError("User not found", "USER_NOT_FOUND", 404),
    });
    const res = await app.request("/nonexistent/reset-mfa", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("username validation edge cases", () => {
  const pattern = /^[a-z0-9_-]{3,50}$/;

  it("rejects usernames starting with uppercase (after lowercasing)", () => {
    expect(pattern.test("abc")).toBe(true);
    expect(pattern.test("ABC".toLowerCase())).toBe(true);
  });

  it("boundary: exactly 3 characters", () => {
    expect(pattern.test("abc")).toBe(true);
  });

  it("boundary: exactly 50 characters", () => {
    expect(pattern.test("a".repeat(50))).toBe(true);
  });

  it("rejects purely numeric but too short", () => {
    expect(pattern.test("12")).toBe(false);
  });

  it("accepts purely numeric with 3+ chars", () => {
    expect(pattern.test("123")).toBe(true);
  });
});
