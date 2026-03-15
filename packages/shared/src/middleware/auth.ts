import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { Database } from "../db";
import type { Project, UserRole } from "../db/schema";
import { AuthError, validateApiKey, validateSession } from "../services/auth";
import type { SafeUser } from "../types";

export type AuthVariables = {
  user: SafeUser;
  sessionId: string | undefined;
  project: Project | undefined;
  scopes: string[] | undefined;
};

export function auth(db: Database, jwtSecret: string, cookieName?: string) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    try {
      if (cookieName) {
        const cookieToken = getCookie(c, cookieName);
        if (cookieToken) {
          const result = await validateSession(db, cookieToken, jwtSecret);
          c.set("user", result.user);
          c.set("sessionId", result.sessionId);
          c.set("project", undefined);
          c.set("scopes", undefined);
          return next();
        }
      }

      const bearer = c.req.header("Authorization");
      if (bearer?.startsWith("Bearer ")) {
        const token = bearer.slice(7);
        const result = await validateSession(db, token, jwtSecret);
        c.set("user", result.user);
        c.set("sessionId", result.sessionId);
        c.set("project", undefined);
        c.set("scopes", undefined);
        return next();
      }

      const apiKey = c.req.header("X-API-Key");
      if (apiKey) {
        const result = await validateApiKey(db, apiKey);
        c.set("user", result.user);
        c.set("sessionId", undefined);
        c.set("project", result.project);
        c.set("scopes", result.scopes);
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

export function requireScope(...requiredScopes: string[]) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const scopes = c.get("scopes");

    // Session-based auth (admin/storage UI) bypasses scope checks — full access
    if (scopes === undefined) {
      return next();
    }

    const hasAll = requiredScopes.every((s) => scopes.includes(s));
    if (!hasAll) {
      return c.json(
        {
          error: {
            code: "INSUFFICIENT_SCOPE",
            message: `Required scopes: ${requiredScopes.join(", ")}`,
          },
        },
        403,
      );
    }

    return next();
  });
}
