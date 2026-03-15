import { createDb } from "@deniz-cloud/shared/db";
import { auth, requireRole } from "@deniz-cloud/shared/middleware";
import { closeMongoClient, createMongoClient } from "@deniz-cloud/shared/mongo";
import { createMeiliClient } from "@deniz-cloud/shared/search";
import { AuthError } from "@deniz-cloud/shared/services";
import { SyncWorker } from "@deniz-cloud/shared/sync";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { config } from "./config";
import { authRoutes } from "./routes/auth";
import { projectRoutes } from "./routes/projects";
import { statsRoutes } from "./routes/stats";
import { userRoutes } from "./routes/users";

const db = createDb(config.databaseUrl);
const meiliClient = createMeiliClient(config.meiliUrl, config.meiliMasterKey);
const mongoClient = createMongoClient(config.mongodbUri);

const syncWorker = new SyncWorker({
  db,
  mongo: mongoClient,
  meili: meiliClient,
});

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

app.use("/api/projects/*", auth(db, config.jwtSecret, COOKIE_NAME));
app.use("/api/projects/*", requireRole("superuser"));
app.route("/api/projects", projectRoutes({ db, meiliClient, syncWorker }));

app.all("/api/*", (c) =>
  c.json({ error: { code: "NOT_FOUND", message: "Endpoint not found" } }, 404),
);

app.use("*", serveStatic({ root: "./static" }));
app.get("*", serveStatic({ root: "./static", rewriteRequestPath: () => "/index.html" }));

mongoClient
  .connect()
  .then(() => {
    console.log("[admin-api] MongoDB connected");
    syncWorker.start().catch((err) => {
      console.error("[admin-api] Sync worker start error:", err);
    });
  })
  .catch((err) => {
    console.error("[admin-api] MongoDB connection failed:", err);
    console.error("[admin-api] Sync worker will not start. Collections can still be managed.");
  });

let isShuttingDown = false;
const shutdown = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log("[admin-api] Shutting down...");
  await syncWorker.stop();
  await closeMongoClient();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export default {
  port: config.port,
  fetch: app.fetch,
};
