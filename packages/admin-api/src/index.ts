import { createDb } from "@deniz-cloud/shared/db";
import { auth, requireRole } from "@deniz-cloud/shared/middleware";
import { createMeiliClient } from "@deniz-cloud/shared/search";
import { AuthError } from "@deniz-cloud/shared/services";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { config } from "./config";
import { authRoutes } from "./routes/auth";
import { searchRoutes } from "./routes/search";
import { statsRoutes } from "./routes/stats";
import { userRoutes } from "./routes/users";

const db = createDb(config.databaseUrl);
const meiliClient = createMeiliClient(config.meiliUrl, config.meiliMasterKey);

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof AuthError) {
    return c.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
  if (err instanceof SyntaxError) {
    return c.json({ error: { code: "INVALID_JSON", message: "Invalid JSON body" } }, 400);
  }
  if ("status" in err && err.status === 400) {
    return c.json({ error: { code: "INVALID_INPUT", message: err.message } }, 400);
  }
  console.error(err);
  return c.json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, 500);
});

app.get("/api/health", (c) => c.json({ status: "ok" }));

const COOKIE_NAME = "dc_admin_session";

app.route(
  "/api/auth",
  authRoutes({
    db,
    jwtSecret: config.jwtSecret,
    totpEncryptionKey: config.totpEncryptionKey,
    cookieName: COOKIE_NAME,
  }),
);

app.use("/api/users/*", auth(db, config.jwtSecret, COOKIE_NAME));
app.use("/api/users/*", requireRole("superuser"));
app.route("/api/users", userRoutes({ db }));

app.use("/api/stats/*", auth(db, config.jwtSecret, COOKIE_NAME));
app.use("/api/stats/*", requireRole("superuser"));
app.route("/api/stats", statsRoutes({ db }));

app.use("/api/search/*", auth(db, config.jwtSecret, COOKIE_NAME));
app.use("/api/search/*", requireRole("superuser"));
app.route("/api/search", searchRoutes({ db, meiliClient }));

app.all("/api/*", (c) =>
  c.json({ error: { code: "NOT_FOUND", message: "Endpoint not found" } }, 404),
);

app.use("*", serveStatic({ root: "./static" }));
app.get("*", serveStatic({ root: "./static", rewriteRequestPath: () => "/index.html" }));

export default {
  port: config.port,
  fetch: app.fetch,
};
