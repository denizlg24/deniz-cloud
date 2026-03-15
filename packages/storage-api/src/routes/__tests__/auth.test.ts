import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

interface TestUser {
  id: string;
  username: string;
  role: "user" | "superuser";
  email?: string;
  totpEnabled: boolean;
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

interface AuthAppVariables {
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

function createAuthApp(overrides: {
  loginResult?: LoginResult;
  loginError?: Error;
  verifyTotpError?: Error;
  useRecoveryCodeError?: Error;
  sessionResult?: SessionResult;
  completeSignupResult?: TestUser;
  completeSignupError?: Error;
  setupTotpUri?: string;
  verifyAndEnableTotpError?: Error;
  recoveryCodes?: string[];
  revokeSessionError?: Error;
  currentUser?: TestUser;
  currentSessionId?: string;
}) {
  const app = new Hono<{ Variables: AuthAppVariables }>();

  app.onError((err, c) => {
    if (err instanceof MockAuthError) {
      return c.json(
        { error: { code: err.code, message: err.message } },
        { status: err.status as 400 | 401 | 403 | 404 },
      );
    }
    if (err.name === "AuthError" && "code" in err && "status" in err) {
      return c.json(
        { error: { code: "SIGNUP_FAILED", message: "Unable to complete signup" } },
        400,
      );
    }
    return c.json({ error: { code: "INTERNAL", message: err.message } }, 500);
  });

  app.post("/login", async (c) => {
    const body = await c.req.json();

    if (typeof body.username !== "string" || typeof body.password !== "string") {
      return c.json(
        { error: { code: "INVALID_INPUT", message: "Username and password are required" } },
        400,
      );
    }

    if (overrides.loginError) throw overrides.loginError;

    const { user, requiresTotp, requiresRecoveryCode } = overrides.loginResult ?? {
      user: {
        id: "u1",
        username: body.username,
        role: "user" as const,
        totpEnabled: false,
      },
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
        expiresAt: session.expiresAt.toISOString(),
        user,
      },
    });
  });

  app.post("/complete-signup", async (c) => {
    const body = await c.req.json();

    if (
      typeof body.username !== "string" ||
      typeof body.email !== "string" ||
      typeof body.password !== "string"
    ) {
      return c.json(
        { error: { code: "INVALID_INPUT", message: "Username, email, and password are required" } },
        400,
      );
    }

    if (body.password.length < 8) {
      return c.json(
        { error: { code: "INVALID_INPUT", message: "Password must be at least 8 characters" } },
        400,
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      return c.json({ error: { code: "INVALID_INPUT", message: "Invalid email address" } }, 400);
    }

    if (overrides.completeSignupError) {
      if (overrides.completeSignupError instanceof MockAuthError) {
        return c.json(
          { error: { code: "SIGNUP_FAILED", message: "Unable to complete signup" } },
          400,
        );
      }
      throw overrides.completeSignupError;
    }

    const user = overrides.completeSignupResult ?? {
      id: "new-user",
      username: body.username.trim().toLowerCase(),
      email: body.email.trim().toLowerCase(),
      role: "user" as const,
      totpEnabled: false,
    };

    const session = overrides.sessionResult ?? {
      token: "signup-jwt",
      expiresAt: new Date("2025-12-31T00:00:00Z"),
    };

    return c.json({
      data: {
        expiresAt: session.expiresAt.toISOString(),
        user,
      },
    });
  });

  // Auth-protected routes
  for (const path of ["/me", "/logout", "/setup-totp", "/verify-totp"]) {
    app.use(path, async (c, next) => {
      if (overrides.currentUser) {
        c.set("user", overrides.currentUser);
        c.set("sessionId", overrides.currentSessionId ?? "session-1");
        return next();
      }
      return c.json({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } }, 401);
    });
  }

  app.get("/me", (c) => c.json({ data: c.get("user") }));

  app.post("/logout", async (c) => {
    const sessionId = c.get("sessionId");
    if (sessionId && overrides.revokeSessionError) throw overrides.revokeSessionError;
    return c.json({ data: { success: true } });
  });

  app.post("/setup-totp", async (c) => {
    const user = c.get("user");
    if (user.totpEnabled) {
      return c.json(
        { error: { code: "TOTP_ALREADY_ENABLED", message: "TOTP is already enabled" } },
        400,
      );
    }
    return c.json({ data: { uri: overrides.setupTotpUri ?? "otpauth://totp/test?secret=ABC" } });
  });

  app.post("/verify-totp", async (c) => {
    const body = await c.req.json();
    if (typeof body.code !== "string") {
      return c.json({ error: { code: "INVALID_INPUT", message: "TOTP code is required" } }, 400);
    }
    if (overrides.verifyAndEnableTotpError) throw overrides.verifyAndEnableTotpError;
    return c.json({
      data: { recoveryCodes: overrides.recoveryCodes ?? ["AAAA-1111", "BBBB-2222"] },
    });
  });

  return app;
}

describe("POST /login", () => {
  it("returns 400 when username is missing", async () => {
    const app = createAuthApp({});
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
    const app = createAuthApp({});
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is empty", async () => {
    const app = createAuthApp({});
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when username is not a string", async () => {
    const app = createAuthApp({});
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: 123, password: "pass" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns expiresAt and user on successful login (no TOTP)", async () => {
    const user: TestUser = {
      id: "u1",
      username: "alice",
      role: "user",
      totpEnabled: false,
    };
    const app = createAuthApp({
      loginResult: { user, requiresTotp: false, requiresRecoveryCode: false },
      sessionResult: { token: "jwt-tok", expiresAt: new Date("2026-01-01T00:00:00Z") },
    });

    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "correct" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.expiresAt).toBe("2026-01-01T00:00:00.000Z");
    expect(body.data.user.id).toBe("u1");
    expect(body.data.user.username).toBe("alice");
  });

  it("does not include token in response body (cookie-based)", async () => {
    const app = createAuthApp({
      sessionResult: { token: "secret-jwt", expiresAt: new Date("2026-01-01T00:00:00Z") },
    });

    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "correct" }),
    });

    const body = await res.json();
    expect(body.data).not.toHaveProperty("token");
  });

  it("returns 401 TOTP_REQUIRED when TOTP is needed", async () => {
    const app = createAuthApp({
      loginResult: {
        user: { id: "u1", username: "alice", role: "user", totpEnabled: true },
        requiresTotp: true,
        requiresRecoveryCode: false,
      },
    });

    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "correct" }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("TOTP_REQUIRED");
    expect(body.requiresRecoveryCode).toBe(false);
  });

  it("includes requiresRecoveryCode=true when applicable", async () => {
    const app = createAuthApp({
      loginResult: {
        user: { id: "u1", username: "alice", role: "user", totpEnabled: true },
        requiresTotp: true,
        requiresRecoveryCode: true,
      },
    });

    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "correct" }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.requiresRecoveryCode).toBe(true);
  });

  it("succeeds with valid TOTP code", async () => {
    const user: TestUser = { id: "u1", username: "alice", role: "user", totpEnabled: true };
    const app = createAuthApp({
      loginResult: { user, requiresTotp: true, requiresRecoveryCode: false },
      sessionResult: { token: "t", expiresAt: new Date("2026-01-01T00:00:00Z") },
    });

    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "correct", totpCode: "123456" }),
    });

    expect(res.status).toBe(200);
  });

  it("succeeds with valid recovery code", async () => {
    const user: TestUser = { id: "u1", username: "alice", role: "user", totpEnabled: true };
    const app = createAuthApp({
      loginResult: { user, requiresTotp: true, requiresRecoveryCode: false },
      sessionResult: { token: "t", expiresAt: new Date("2026-01-01T00:00:00Z") },
    });

    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "correct", recoveryCode: "ABCD-1234" }),
    });

    expect(res.status).toBe(200);
  });

  it("prefers totpCode over recoveryCode", async () => {
    const user: TestUser = { id: "u1", username: "alice", role: "user", totpEnabled: true };
    const app = createAuthApp({
      loginResult: { user, requiresTotp: true, requiresRecoveryCode: false },
    });

    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "alice",
        password: "correct",
        totpCode: "123456",
        recoveryCode: "ABCD-1234",
      }),
    });

    expect(res.status).toBe(200);
  });
});

describe("POST /complete-signup", () => {
  it("returns 400 when username is missing", async () => {
    const app = createAuthApp({});
    const res = await app.request("/complete-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.com", password: "password123" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("Username, email, and password");
  });

  it("returns 400 when email is missing", async () => {
    const app = createAuthApp({});
    const res = await app.request("/complete-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "password123" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when password is missing", async () => {
    const app = createAuthApp({});
    const res = await app.request("/complete-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", email: "a@b.com" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when password is too short", async () => {
    const app = createAuthApp({});
    const res = await app.request("/complete-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", email: "a@b.com", password: "short" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("at least 8 characters");
  });

  it("accepts exactly 8-character password", async () => {
    const app = createAuthApp({});
    const res = await app.request("/complete-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", email: "a@b.com", password: "12345678" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 400 for invalid email format", async () => {
    const app = createAuthApp({});
    const invalidEmails = ["notanemail", "missing@domain", "@no-local.com", "has spaces@test.com"];

    for (const email of invalidEmails) {
      const res = await app.request("/complete-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "alice", email, password: "password123" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("Invalid email");
    }
  });

  it("accepts valid email formats", async () => {
    const app = createAuthApp({});
    const validEmails = ["test@example.com", "user.name@domain.co", "a@b.io"];

    for (const email of validEmails) {
      const res = await app.request("/complete-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "alice", email, password: "password123" }),
      });
      expect(res.status).toBe(200);
    }
  });

  it("returns generic error on AuthError (prevents username enumeration)", async () => {
    const app = createAuthApp({
      completeSignupError: new MockAuthError("User not found", "USER_NOT_FOUND", 404),
    });
    const res = await app.request("/complete-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "nonexistent", email: "a@b.com", password: "password123" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("SIGNUP_FAILED");
    expect(body.error.message).toBe("Unable to complete signup");
    expect(body.error.message).not.toContain("not found");
  });

  it("returns user and expiresAt on success", async () => {
    const app = createAuthApp({
      sessionResult: { token: "t", expiresAt: new Date("2026-06-01T00:00:00Z") },
    });
    const res = await app.request("/complete-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Alice", email: "ALICE@Test.COM", password: "password123" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.expiresAt).toBe("2026-06-01T00:00:00.000Z");
    expect(body.data.user.username).toBe("alice");
  });
});

describe("GET /me", () => {
  it("returns the authenticated user", async () => {
    const user: TestUser = {
      id: "u1",
      username: "alice",
      role: "user",
      totpEnabled: true,
    };
    const app = createAuthApp({ currentUser: user });
    const res = await app.request("/me");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe("u1");
    expect(body.data.username).toBe("alice");
  });

  it("returns 401 when not authenticated", async () => {
    const app = createAuthApp({});
    const res = await app.request("/me");
    expect(res.status).toBe(401);
  });
});

describe("POST /logout", () => {
  it("returns success on logout", async () => {
    const app = createAuthApp({
      currentUser: { id: "u1", username: "alice", role: "user", totpEnabled: true },
      currentSessionId: "sess-1",
    });
    const res = await app.request("/logout", { method: "POST" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.success).toBe(true);
  });

  it("returns 401 when not authenticated", async () => {
    const app = createAuthApp({});
    const res = await app.request("/logout", { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("POST /setup-totp", () => {
  it("returns TOTP URI when TOTP is not yet enabled", async () => {
    const app = createAuthApp({
      currentUser: { id: "u1", username: "alice", role: "user", totpEnabled: false },
      setupTotpUri: "otpauth://totp/DenizCloud:alice?secret=JBSWY3DPEHPK3PXP",
    });
    const res = await app.request("/setup-totp", { method: "POST" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.uri).toStartWith("otpauth://");
  });

  it("returns 400 when TOTP is already enabled", async () => {
    const app = createAuthApp({
      currentUser: { id: "u1", username: "alice", role: "user", totpEnabled: true },
    });
    const res = await app.request("/setup-totp", { method: "POST" });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("TOTP_ALREADY_ENABLED");
  });

  it("returns 401 when not authenticated", async () => {
    const app = createAuthApp({});
    const res = await app.request("/setup-totp", { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("POST /verify-totp", () => {
  it("returns recovery codes on successful verification", async () => {
    const app = createAuthApp({
      currentUser: { id: "u1", username: "alice", role: "user", totpEnabled: false },
      recoveryCodes: ["AAAA-1111", "BBBB-2222", "CCCC-3333"],
    });
    const res = await app.request("/verify-totp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "123456" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.recoveryCodes).toHaveLength(3);
    expect(body.data.recoveryCodes).toContain("AAAA-1111");
  });

  it("returns 400 when code is missing", async () => {
    const app = createAuthApp({
      currentUser: { id: "u1", username: "alice", role: "user", totpEnabled: false },
    });
    const res = await app.request("/verify-totp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 400 when code is not a string", async () => {
    const app = createAuthApp({
      currentUser: { id: "u1", username: "alice", role: "user", totpEnabled: false },
    });
    const res = await app.request("/verify-totp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: 123456 }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    const app = createAuthApp({});
    const res = await app.request("/verify-totp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "123456" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("email validation regex", () => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  it("accepts standard emails", () => {
    expect(emailRegex.test("user@example.com")).toBe(true);
    expect(emailRegex.test("test.user@domain.co")).toBe(true);
    expect(emailRegex.test("a@b.c")).toBe(true);
  });

  it("rejects emails without @", () => {
    expect(emailRegex.test("userexample.com")).toBe(false);
  });

  it("rejects emails without domain part", () => {
    expect(emailRegex.test("user@")).toBe(false);
  });

  it("rejects emails without TLD", () => {
    expect(emailRegex.test("user@domain")).toBe(false);
  });

  it("rejects emails with spaces", () => {
    expect(emailRegex.test("user @example.com")).toBe(false);
    expect(emailRegex.test("user@ example.com")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(emailRegex.test("")).toBe(false);
  });
});
