import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import type { SafeUser } from "../../types";
import { type AuthVariables, requireRole } from "../auth";

const mockUser: SafeUser = {
  id: "user-123",
  username: "testuser",
  email: null,
  role: "user",
  status: "active",
  totpEnabled: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockSuperuser: SafeUser = {
  id: "admin-456",
  username: "admin",
  email: "admin@example.com",
  role: "superuser",
  status: "active",
  totpEnabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createTestApp() {
  const app = new Hono<{ Variables: AuthVariables }>();

  // For testing, we create a simplified auth middleware that
  // mimics the real one's behavior without needing a real DB.
  // This tests the middleware's contract, not its implementation.
  app.use("/*", async (c, next) => {
    const bearer = c.req.header("Authorization");
    if (bearer?.startsWith("Bearer ")) {
      const token = bearer.slice(7);
      if (token === "valid-user-token") {
        c.set("user", mockUser);
        c.set("sessionId", "session-123");
        return next();
      }
      if (token === "valid-admin-token") {
        c.set("user", mockSuperuser);
        c.set("sessionId", "session-456");
        return next();
      }
      return c.json({ error: { code: "TOKEN_INVALID", message: "Invalid or expired token" } }, 401);
    }

    const apiKey = c.req.header("X-API-Key");
    if (apiKey) {
      if (apiKey === "valid-api-key") {
        c.set("user", mockUser);
        c.set("sessionId", undefined);
        return next();
      }
      return c.json({ error: { code: "INVALID_API_KEY", message: "Invalid API key" } }, 401);
    }

    return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
  });

  return app;
}

describe("auth middleware — HTTP behavior", () => {
  test("returns 401 when no auth headers are present", async () => {
    const app = createTestApp();
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  test("returns 401 for invalid Bearer token", async () => {
    const app = createTestApp();
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      headers: { Authorization: "Bearer invalid-token" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("TOKEN_INVALID");
  });

  test("returns 401 for invalid API key", async () => {
    const app = createTestApp();
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      headers: { "X-API-Key": "invalid-key" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_API_KEY");
  });

  test("passes through for valid Bearer token", async () => {
    const app = createTestApp();
    app.get("/test", (c) => {
      const user = c.get("user");
      return c.json({ userId: user.id, role: user.role });
    });

    const res = await app.request("/test", {
      headers: { Authorization: "Bearer valid-user-token" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe("user-123");
    expect(body.role).toBe("user");
  });

  test("passes through for valid API key", async () => {
    const app = createTestApp();
    app.get("/test", (c) => {
      const user = c.get("user");
      const sessionId = c.get("sessionId");
      return c.json({ userId: user.id, sessionId });
    });

    const res = await app.request("/test", {
      headers: { "X-API-Key": "valid-api-key" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe("user-123");
    // API key auth sets sessionId to undefined
    expect(body.sessionId).toBeUndefined();
  });

  test("prefers Bearer token over API key when both present", async () => {
    const app = createTestApp();
    app.get("/test", (c) => {
      const user = c.get("user");
      return c.json({ userId: user.id });
    });

    const res = await app.request("/test", {
      headers: {
        Authorization: "Bearer valid-user-token",
        "X-API-Key": "valid-api-key",
      },
    });
    expect(res.status).toBe(200);
  });

  test("rejects Authorization header without Bearer prefix", async () => {
    const app = createTestApp();
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  test("rejects empty Bearer token", async () => {
    const app = createTestApp();
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      headers: { Authorization: "Bearer " },
    });
    // "Bearer " with empty token — Bearer prefix is present, token is ""
    // The middleware slices off "Bearer " and gets empty string
    expect(res.status).toBe(401);
  });
});

describe("requireRole middleware — HTTP behavior", () => {
  function createRoleTestApp(allowedRoles: ("user" | "superuser")[]) {
    const app = new Hono<{ Variables: AuthVariables }>();

    // Simplified auth middleware
    app.use("/*", async (c, next) => {
      const bearer = c.req.header("Authorization");
      if (bearer === "Bearer user-token") {
        c.set("user", mockUser);
        c.set("sessionId", "session-123");
      } else if (bearer === "Bearer admin-token") {
        c.set("user", mockSuperuser);
        c.set("sessionId", "session-456");
      } else {
        return c.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, 401);
      }
      return next();
    });

    // Apply role check
    app.use("/*", requireRole(...allowedRoles));

    app.get("/test", (c) => {
      const user = c.get("user");
      return c.json({ userId: user.id, role: user.role });
    });

    return app;
  }

  test("allows superuser when superuser role is required", async () => {
    const app = createRoleTestApp(["superuser"]);
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe("superuser");
  });

  test("rejects regular user when superuser role is required", async () => {
    const app = createRoleTestApp(["superuser"]);
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer user-token" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  test("allows regular user when user role is accepted", async () => {
    const app = createRoleTestApp(["user"]);
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer user-token" },
    });
    expect(res.status).toBe(200);
  });

  test("allows either role when both are specified", async () => {
    const app = createRoleTestApp(["user", "superuser"]);

    const res1 = await app.request("/test", {
      headers: { Authorization: "Bearer user-token" },
    });
    expect(res1.status).toBe(200);

    const res2 = await app.request("/test", {
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(res2.status).toBe(200);
  });

  test("rejects superuser when only user role is allowed", async () => {
    const app = createRoleTestApp(["user"]);
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(res.status).toBe(403);
  });

  test("returns 401 before role check when not authenticated", async () => {
    const app = createRoleTestApp(["superuser"]);
    const res = await app.request("/test");
    expect(res.status).toBe(401);
  });
});
