import { createDb } from "@deniz-cloud/shared/db";
import { auth, requireRole } from "@deniz-cloud/shared/middleware";
import { closeMongoClient, createMongoClient } from "@deniz-cloud/shared/mongo";
import { createMeiliClient } from "@deniz-cloud/shared/search";
import { AuthError, validateSession } from "@deniz-cloud/shared/services";
import { SyncWorker } from "@deniz-cloud/shared/sync";
import type { Server, ServerWebSocket } from "bun";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { MongoClient } from "mongodb";
import { config } from "./config";
import { createProxyHandler } from "./proxy";
import { authRoutes } from "./routes/auth";
import { mongoDbRoutes } from "./routes/db-mongodb";
import { postgresDbRoutes } from "./routes/db-postgres";
import { projectDatabaseRoutes } from "./routes/project-databases";
import { projectRoutes } from "./routes/projects";
import { statsRoutes } from "./routes/stats";
import { taskRoutes } from "./routes/tasks";
import { userRoutes } from "./routes/users";
import { startScheduler, stopScheduler } from "./scheduler";

const db = createDb(config.databaseUrl);
const meiliClient = createMeiliClient(config.meiliUrl, config.meiliMasterKey);
const mongoClient = createMongoClient(config.mongodbUri);
const mongoAdminClient = new MongoClient(config.mongodbAdminUri, {
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 5000,
});

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

app.route(
  "/api/projects",
  projectDatabaseRoutes({
    db,
    databaseUrl: config.databaseUrl,
    mongoAdminClient,
    totpEncryptionKey: config.totpEncryptionKey,
    postgresInternalHost: config.postgresInternalHost,
    postgresExternalHost: config.postgresExternalHost,
    mongodbInternalHost: config.mongodbInternalHost,
    mongodbExternalHost: config.mongodbExternalHost,
  }),
);

app.use("/api/tasks/*", auth(db, config.jwtSecret, COOKIE_NAME));
app.use("/api/tasks/*", requireRole("superuser"));
app.route("/api/tasks", taskRoutes({ db }));

app.use("/api/db/*", auth(db, config.jwtSecret, COOKIE_NAME));
app.use("/api/db/*", requireRole("superuser"));
app.route("/api/db/postgres", postgresDbRoutes({ db, databaseUrl: config.databaseUrl }));
app.route("/api/db/mongodb", mongoDbRoutes({ mongoClient: mongoAdminClient }));

app.all("/api/*", (c) =>
  c.json({ error: { code: "NOT_FOUND", message: "Endpoint not found" } }, 404),
);

const toolsAuth = auth(db, config.jwtSecret, COOKIE_NAME);
const toolsRole = requireRole("superuser");

app.use("/tools/adminer", toolsAuth, toolsRole);
app.use("/tools/adminer/*", toolsAuth, toolsRole);
app.all("/tools/adminer", createProxyHandler(config.adminerUrl, "/tools/adminer"));
app.all("/tools/adminer/*", createProxyHandler(config.adminerUrl, "/tools/adminer"));

app.use("/tools/mongo-ui", toolsAuth, toolsRole);
app.use("/tools/mongo-ui/*", toolsAuth, toolsRole);
app.all("/tools/mongo-ui", createProxyHandler(config.mongoExpressUrl, ""));
app.all("/tools/mongo-ui/*", createProxyHandler(config.mongoExpressUrl, ""));

app.use("*", serveStatic({ root: "./static" }));
app.get("*", serveStatic({ root: "./static", rewriteRequestPath: () => "/index.html" }));

Promise.all([mongoClient.connect(), mongoAdminClient.connect()])
  .then(() => {
    console.log("[admin-api] MongoDB connected (sync + admin)");
    syncWorker.start().catch((err) => {
      console.error("[admin-api] Sync worker start error:", err);
    });
  })
  .catch((err) => {
    console.error("[admin-api] MongoDB connection failed:", err);
    console.error("[admin-api] Sync worker will not start. Collections can still be managed.");
  });

startScheduler(db).catch((err) => {
  console.error("[admin-api] Scheduler start error:", err);
});

let isShuttingDown = false;
const shutdown = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log("[admin-api] Shutting down...");
  stopScheduler();
  await syncWorker.stop();
  await mongoAdminClient.close();
  await closeMongoClient();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

interface TerminalWsData {
  token: string;
  upstream: WebSocket | null;
}

function extractCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  const match = header.split(";").find((c) => c.trim().startsWith(`${name}=`));
  return match ? (match.split("=")[1]?.trim() ?? null) : null;
}

export default {
  port: config.port,
  fetch(req: Request, server: Server<TerminalWsData>) {
    const url = new URL(req.url);

    if (url.pathname === "/api/terminal") {
      const token = extractCookie(req, COOKIE_NAME);
      if (!token) {
        return new Response("Unauthorized", { status: 401 });
      }

      const upgradeData: TerminalWsData = { token, upstream: null };
      if (
        server.upgrade(req, {
          data: upgradeData,
        })
      ) {
        return undefined;
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    return app.fetch(req, server);
  },
  websocket: {
    async open(ws: ServerWebSocket<TerminalWsData>) {
      const { token } = ws.data;
      if (!token) {
        ws.close(1008, "Unauthorized");
        return;
      }

      try {
        const { user } = await validateSession(db, token, config.jwtSecret);
        if (user.role !== "superuser") {
          ws.close(1008, "Forbidden");
          return;
        }
      } catch {
        ws.close(1008, "Unauthorized");
        return;
      }

      const upstream = new WebSocket(config.terminalServerUrl);

      ws.data.upstream = upstream;

      upstream.addEventListener("message", (event) => {
        try {
          if (typeof event.data === "string") {
            ws.send(event.data);
          } else if (event.data instanceof ArrayBuffer) {
            ws.send(new Uint8Array(event.data));
          }
        } catch {
          upstream.close();
        }
      });

      upstream.addEventListener("close", () => {
        try {
          ws.close(1000, "Terminal closed");
        } catch {}
      });

      upstream.addEventListener("error", () => {
        try {
          ws.close(1011, "Terminal server error");
        } catch {}
      });
    },

    message(ws: ServerWebSocket<TerminalWsData>, message: string | ArrayBuffer) {
      const upstream = ws.data.upstream;
      if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
      upstream.send(message);
    },

    close(ws: ServerWebSocket<TerminalWsData>) {
      const upstream = ws.data.upstream;
      if (upstream && upstream.readyState === WebSocket.OPEN) {
        upstream.close();
      }
    },
  },
};
