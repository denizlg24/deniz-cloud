import type { Database } from "@deniz-cloud/shared/db";
import {
  type AuthVariables,
  auth,
  rateLimit,
  sessionCookieOptions,
} from "@deniz-cloud/shared/middleware";
import {
  AuthError,
  completeSignup,
  createSession,
  generateAndStoreRecoveryCodes,
  loginWithPassword,
  revokeSession,
  setupTotp,
  useRecoveryCode,
  verifyAndEnableTotp,
  verifyTotp,
} from "@deniz-cloud/shared/services";
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";

interface AuthRouteDeps {
  db: Database;
  jwtSecret: string;
  totpEncryptionKey: string;
  cookieName: string;
}

export function authRoutes({ db, jwtSecret, totpEncryptionKey, cookieName }: AuthRouteDeps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const authMw = auth(db, jwtSecret, cookieName);
  const { name: _name, ...cookieOptions } = sessionCookieOptions(cookieName);

  app.use("/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }));
  app.use("/complete-signup", rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }));

  app.post("/login", async (c) => {
    const body = await c.req.json();

    if (typeof body.username !== "string" || typeof body.password !== "string") {
      return c.json(
        { error: { code: "INVALID_INPUT", message: "Username and password are required" } },
        400,
      );
    }

    const { user, requiresTotp, requiresRecoveryCode } = await loginWithPassword(db, {
      username: body.username,
      password: body.password,
    });

    if (requiresTotp) {
      if (typeof body.totpCode === "string") {
        await verifyTotp(db, user.id, body.totpCode, totpEncryptionKey);
      } else if (typeof body.recoveryCode === "string") {
        await useRecoveryCode(db, user.id, body.recoveryCode);
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

    const session = await createSession(db, user.id, user.role, jwtSecret);
    setCookie(c, cookieName, session.token, cookieOptions);

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

    try {
      const user = await completeSignup(db, {
        username: body.username.trim().toLowerCase(),
        email: body.email.trim().toLowerCase(),
        password: body.password,
      });

      const session = await createSession(db, user.id, user.role, jwtSecret);
      setCookie(c, cookieName, session.token, cookieOptions);

      return c.json({
        data: {
          expiresAt: session.expiresAt.toISOString(),
          user,
        },
      });
    } catch (err) {
      if (err instanceof AuthError) {
        return c.json(
          { error: { code: "SIGNUP_FAILED", message: "Unable to complete signup" } },
          400,
        );
      }
      throw err;
    }
  });

  app.use("/me", authMw);
  app.use("/logout", authMw);
  app.use("/setup-totp", authMw);
  app.use("/verify-totp", authMw);

  app.get("/me", async (c) => {
    return c.json({ data: c.get("user") });
  });

  app.post("/logout", async (c) => {
    const sessionId = c.get("sessionId");
    if (sessionId) {
      await revokeSession(db, sessionId);
    }
    deleteCookie(c, cookieName, { path: "/api" });
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

    const { uri } = await setupTotp(db, user.id, totpEncryptionKey);
    return c.json({ data: { uri } });
  });

  app.post("/verify-totp", async (c) => {
    const user = c.get("user");
    const body = await c.req.json();

    if (typeof body.code !== "string") {
      return c.json({ error: { code: "INVALID_INPUT", message: "TOTP code is required" } }, 400);
    }

    await verifyAndEnableTotp(db, user.id, body.code, totpEncryptionKey);
    const recoveryCodes = await generateAndStoreRecoveryCodes(db, user.id);

    return c.json({ data: { recoveryCodes } });
  });

  return app;
}
