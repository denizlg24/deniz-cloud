import { createMiddleware } from "hono/factory";
import type { Database } from "../db";
import type { UserRole } from "../db/schema";
import { AuthError, validateApiKey, validateSession } from "../services/auth";
import type { SafeUser } from "../types";

export type AuthVariables = {
  user: SafeUser;
  sessionId: string | undefined;
};

export function auth(db: Database, jwtSecret: string) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    try {
      const bearer = c.req.header("Authorization");
      if (bearer?.startsWith("Bearer ")) {
        const token = bearer.slice(7);
        const result = await validateSession(db, token, jwtSecret);
        c.set("user", result.user);
        c.set("sessionId", result.sessionId);
        return next();
      }

      const apiKey = c.req.header("X-API-Key");
      if (apiKey) {
        const user = await validateApiKey(db, apiKey);
        c.set("user", user);
        c.set("sessionId", undefined);
        return next();
      }

      return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
    } catch (err) {
      if (err instanceof AuthError) {
        return c.json({ error: { code: err.code, message: err.message } }, { status: err.status });
      }
      throw err;
    }
  });
}

export function requireRole(...roles: UserRole[]) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const user = c.get("user");
    if (!roles.includes(user.role)) {
      return c.json({ error: { code: "FORBIDDEN", message: "Insufficient permissions" } }, 403);
    }
    return next();
  });
}
