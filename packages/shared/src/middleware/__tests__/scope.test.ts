import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import type { SafeUser } from "../../types";
import { type AuthVariables, requireScope } from "../auth";

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

function createScopeTestApp(config: {
  authType: "session" | "apikey";
  scopes?: string[];
  requiredScopes: string[];
}) {
  const app = new Hono<{ Variables: AuthVariables }>();

  // Simulated auth middleware that sets variables based on auth type
  app.use("/*", async (c, next) => {
    c.set("user", mockUser);

    if (config.authType === "session") {
      c.set("sessionId", "session-123");
      c.set("project", undefined);
      c.set("scopes", undefined);
    } else {
      c.set("sessionId", undefined);
      c.set("project", undefined);
      c.set("scopes", config.scopes ?? []);
    }

    return next();
  });

  app.use("/*", requireScope(...config.requiredScopes));

  app.get("/test", (c) => {
    return c.json({ ok: true });
  });

  return app;
}

describe("requireScope middleware", () => {
  test("session auth bypasses scope checks (scopes undefined)", async () => {
    const app = createScopeTestApp({
      authType: "session",
      requiredScopes: ["storage:read", "storage:write"],
    });

    const res = await app.request("/test");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("API key auth with matching single scope passes", async () => {
    const app = createScopeTestApp({
      authType: "apikey",
      scopes: ["storage:read", "storage:write"],
      requiredScopes: ["storage:read"],
    });

    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  test("API key auth without required scope returns 403", async () => {
    const app = createScopeTestApp({
      authType: "apikey",
      scopes: ["storage:read"],
      requiredScopes: ["storage:write"],
    });

    const res = await app.request("/test");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("INSUFFICIENT_SCOPE");
    expect(body.error.message).toContain("storage:write");
  });

  test("API key auth with empty scopes returns 403", async () => {
    const app = createScopeTestApp({
      authType: "apikey",
      scopes: [],
      requiredScopes: ["storage:read"],
    });

    const res = await app.request("/test");
    expect(res.status).toBe(403);
  });

  test("requires ALL scopes (all-of matching), not any-of", async () => {
    const app = createScopeTestApp({
      authType: "apikey",
      scopes: ["storage:read"],
      requiredScopes: ["storage:read", "storage:write"],
    });

    const res = await app.request("/test");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toContain("storage:read");
    expect(body.error.message).toContain("storage:write");
  });

  test("passes when API key has all required scopes", async () => {
    const app = createScopeTestApp({
      authType: "apikey",
      scopes: ["storage:read", "storage:write", "storage:delete"],
      requiredScopes: ["storage:read", "storage:write"],
    });

    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  test("passes when API key has exactly the required scopes", async () => {
    const app = createScopeTestApp({
      authType: "apikey",
      scopes: ["search:read", "search:write"],
      requiredScopes: ["search:read", "search:write"],
    });

    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  test("error message lists all required scopes", async () => {
    const app = createScopeTestApp({
      authType: "apikey",
      scopes: [],
      requiredScopes: ["search:read", "search:manage"],
    });

    const res = await app.request("/test");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toBe("Required scopes: search:read, search:manage");
  });

  test("no required scopes always passes for API key auth", async () => {
    const app = createScopeTestApp({
      authType: "apikey",
      scopes: [],
      requiredScopes: [],
    });

    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  test("session auth bypasses even with no required scopes", async () => {
    const app = createScopeTestApp({
      authType: "session",
      requiredScopes: [],
    });

    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });
});
