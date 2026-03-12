import type { Database } from "@deniz-cloud/shared/db";
import { type AuthVariables, auth } from "@deniz-cloud/shared/middleware";
import {
  createSession,
  loginWithPassword,
  revokeSession,
  useRecoveryCode,
  verifyTotp,
} from "@deniz-cloud/shared/services";
import { Hono } from "hono";

interface AuthRouteDeps {
  db: Database;
  jwtSecret: string;
  totpEncryptionKey: string;
}

export function authRoutes({ db, jwtSecret, totpEncryptionKey }: AuthRouteDeps) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const authMw = auth(db, jwtSecret);

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

    return c.json({
      data: {
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
        user,
      },
    });
  });

  app.use("/me", authMw);
  app.use("/logout", authMw);

  app.get("/me", async (c) => {
    return c.json({ data: c.get("user") });
  });

  app.post("/logout", async (c) => {
    const sessionId = c.get("sessionId");
    if (sessionId) {
      await revokeSession(db, sessionId);
    }
    return c.json({ data: { success: true } });
  });

  return app;
}
