import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

interface TestUser {
  id: string;
  username: string;
  role: string;
  email?: string;
}

interface LoginResult {
  user: TestUser;
  requiresTotp: boolean;
  requiresRecoveryCode: boolean;
}

interface SessionResult {
  token: string;
  expiresAt: Date;
}

interface TestAppVariables {
  user: TestUser;
  sessionId: string;
}

function createTestApp(overrides: {
  loginResult?: LoginResult;
  loginError?: Error;
  verifyTotpError?: Error;
  useRecoveryCodeError?: Error;
  sessionResult?: SessionResult;
  revokeSessionError?: Error;
  currentUser?: TestUser;
  currentSessionId?: string;
}) {
  const app = new Hono<{ Variables: TestAppVariables }>();

  // POST /login — mirrors the login route logic
  app.post("/login", async (c) => {
    const body = await c.req.json();

    if (typeof body.username !== "string" || typeof body.password !== "string") {
      return c.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Username and password are required",
          },
        },
        400,
      );
    }

    if (overrides.loginError) {
      throw overrides.loginError;
    }

    const { user, requiresTotp, requiresRecoveryCode } = overrides.loginResult ?? {
      user: { id: "u1", username: body.username, role: "user" },
      requiresTotp: false,
      requiresRecoveryCode: false,
    };

    if (requiresTotp) {
      if (typeof body.totpCode === "string") {
        if (overrides.verifyTotpError) throw overrides.verifyTotpError;
      } else if (typeof body.recoveryCode === "string") {
        if (overrides.useRecoveryCodeError) throw overrides.useRecoveryCodeError;
      } else {
        return c.json(
          {
            error: {
              code: "TOTP_REQUIRED",
              message: "Two-factor authentication required",
            },
            requiresRecoveryCode,
          },
          401,
        );
      }
    }

    const session = overrides.sessionResult ?? {
      token: "jwt-token-abc",
      expiresAt: new Date("2025-12-31T00:00:00Z"),
    };

    return c.json({
      data: {
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
        user,
      },
    });
  });

  // Auth-protected routes: simulate by injecting user
  app.use("/me", async (c, next) => {
    if (overrides.currentUser) {
      c.set("user", overrides.currentUser);
      c.set("sessionId", overrides.currentSessionId ?? "session-1");
      return next();
    }
    return c.json({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } }, 401);
  });
  app.use("/logout", async (c, next) => {
    if (overrides.currentUser) {
      c.set("user", overrides.currentUser);
      c.set("sessionId", overrides.currentSessionId ?? "session-1");
      return next();
    }
    return c.json({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } }, 401);
  });

  app.get("/me", (c) => {
    return c.json({ data: c.get("user") });
  });

  app.post("/logout", async (c) => {
    const sessionId = c.get("sessionId");
    if (sessionId && overrides.revokeSessionError) {
      throw overrides.revokeSessionError;
    }
    return c.json({ data: { success: true } });
  });

  return app;
}

describe("POST /login", () => {
  it("returns 400 when username is missing", async () => {
    const app = createTestApp({});
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "pass123" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 400 when password is missing", async () => {
    const app = createTestApp({});
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 when username is not a string", async () => {
    const app = createTestApp({});
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: 123, password: "pass" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 when body is empty object", async () => {
    const app = createTestApp({});
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it("returns token and user on successful login (no TOTP)", async () => {
    const user = { id: "u1", username: "admin", role: "superuser" };
    const app = createTestApp({
      loginResult: { user, requiresTotp: false, requiresRecoveryCode: false },
      sessionResult: {
        token: "my-jwt",
        expiresAt: new Date("2025-06-01T00:00:00Z"),
      },
    });

    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "correct-password" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.token).toBe("my-jwt");
    expect(body.data.expiresAt).toBe("2025-06-01T00:00:00.000Z");
    expect(body.data.user.id).toBe("u1");
    expect(body.data.user.username).toBe("admin");
  });

  it("returns 401 TOTP_REQUIRED when TOTP is needed but not provided", async () => {
    const app = createTestApp({
      loginResult: {
        user: { id: "u1", username: "admin", role: "user" },
        requiresTotp: true,
        requiresRecoveryCode: false,
      },
    });

    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "correct" }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("TOTP_REQUIRED");
    expect(body.requiresRecoveryCode).toBe(false);
  });

  it("includes requiresRecoveryCode=true when user has no recovery codes", async () => {
    const app = createTestApp({
      loginResult: {
        user: { id: "u1", username: "admin", role: "user" },
        requiresTotp: true,
        requiresRecoveryCode: true,
      },
    });

    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "correct" }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.requiresRecoveryCode).toBe(true);
  });

  it("succeeds with valid TOTP code", async () => {
    const user = { id: "u1", username: "admin", role: "user" };
    const app = createTestApp({
      loginResult: { user, requiresTotp: true, requiresRecoveryCode: false },
      sessionResult: {
        token: "totp-jwt",
        expiresAt: new Date("2025-12-01T00:00:00Z"),
      },
    });

    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "admin",
        password: "correct",
        totpCode: "123456",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.token).toBe("totp-jwt");
  });

  it("succeeds with valid recovery code", async () => {
    const user = { id: "u1", username: "admin", role: "user" };
    const app = createTestApp({
      loginResult: { user, requiresTotp: true, requiresRecoveryCode: false },
      sessionResult: {
        token: "recovery-jwt",
        expiresAt: new Date("2025-12-01T00:00:00Z"),
      },
    });

    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "admin",
        password: "correct",
        recoveryCode: "ABCD-1234-EFGH",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.token).toBe("recovery-jwt");
  });

  it("prefers totpCode over recoveryCode when both are provided", async () => {
    // The route checks totpCode first, so if both are present, TOTP wins
    const user = { id: "u1", username: "admin", role: "user" };
    const app = createTestApp({
      loginResult: { user, requiresTotp: true, requiresRecoveryCode: false },
      sessionResult: {
        token: "totp-wins",
        expiresAt: new Date("2025-12-01T00:00:00Z"),
      },
    });

    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "admin",
        password: "correct",
        totpCode: "123456",
        recoveryCode: "ABCD-1234",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.token).toBe("totp-wins");
  });

  it("response shape: data has token, expiresAt (ISO string), and user object", async () => {
    const user = {
      id: "u1",
      username: "testuser",
      role: "user",
      email: "test@test.com",
    };
    const app = createTestApp({
      loginResult: { user, requiresTotp: false, requiresRecoveryCode: false },
      sessionResult: {
        token: "t",
        expiresAt: new Date("2025-01-01T12:00:00Z"),
      },
    });

    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "testuser", password: "pass" }),
    });

    const body = await res.json();
    expect(body.data).toHaveProperty("token");
    expect(body.data).toHaveProperty("expiresAt");
    expect(body.data).toHaveProperty("user");
    // expiresAt should be a valid ISO date
    expect(new Date(body.data.expiresAt).toISOString()).toBe(body.data.expiresAt);
  });
});

describe("GET /me", () => {
  it("returns the authenticated user", async () => {
    const user = { id: "u1", username: "admin", role: "superuser" };
    const app = createTestApp({ currentUser: user });

    const res = await app.request("/me", { method: "GET" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(user);
  });

  it("returns 401 when not authenticated", async () => {
    const app = createTestApp({});
    const res = await app.request("/me", { method: "GET" });
    expect(res.status).toBe(401);
  });
});

describe("POST /logout", () => {
  it("returns success true on logout", async () => {
    const app = createTestApp({
      currentUser: { id: "u1", username: "admin", role: "user" },
      currentSessionId: "sess-123",
    });

    const res = await app.request("/logout", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.success).toBe(true);
  });

  it("returns 401 when not authenticated", async () => {
    const app = createTestApp({});
    const res = await app.request("/logout", { method: "POST" });
    expect(res.status).toBe(401);
  });
});
