import type { Database } from "@deniz-cloud/shared/db";
import type { AuthVariables } from "@deniz-cloud/shared/middleware";
import {
  createPendingUser,
  deleteUser,
  listUsers,
  resetUserMfa,
} from "@deniz-cloud/shared/services";
import { Hono } from "hono";

interface UserRouteDeps {
  db: Database;
}

export function userRoutes({ db }: UserRouteDeps) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/", async (c) => {
    const page = parseInt(c.req.query("page") ?? "1", 10);
    const limit = parseInt(c.req.query("limit") ?? "50", 10);

    if (page < 1 || limit < 1 || limit > 100) {
      return c.json(
        { error: { code: "INVALID_INPUT", message: "Invalid pagination parameters" } },
        400,
      );
    }

    const result = await listUsers(db, { page, limit });

    return c.json({
      data: result.users,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
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

    const role = body.role === "superuser" ? "superuser" : "user";

    const user = await createPendingUser(db, { username, role });
    return c.json({ data: user }, 201);
  });

  app.delete("/:id", async (c) => {
    const userId = c.req.param("id");
    await deleteUser(db, userId);
    return c.json({ data: { success: true } });
  });

  app.post("/:id/reset-mfa", async (c) => {
    const userId = c.req.param("id");
    await resetUserMfa(db, userId);
    return c.json({ data: { success: true } });
  });

  return app;
}
