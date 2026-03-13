import { createDb } from "@deniz-cloud/shared/db";
import { auth } from "@deniz-cloud/shared/middleware";
import { AuthError } from "@deniz-cloud/shared/services";
import { Hono } from "hono";
import { startCleanupScheduler } from "./cleanup";
import { config } from "./config";
import { fileRoutes } from "./routes/files";
import { folderRoutes } from "./routes/folders";
import { uploadRoutes } from "./routes/uploads";
import { PathValidationError } from "./utils/path";
import { ensureSharedFolder, initStorageDirs } from "./utils/storage";

const db = createDb(config.databaseUrl);

await initStorageDirs(config);
await ensureSharedFolder(db, config);
startCleanupScheduler(db);

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof AuthError) {
    return c.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
  if (err instanceof PathValidationError) {
    return c.json({ error: { code: "INVALID_PATH", message: err.message } }, 400);
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

const authMiddleware = auth(db, config.jwtSecret);

app.use("/api/uploads/*", authMiddleware);
app.route(
  "/api/uploads",
  uploadRoutes({
    db,
    ssdStoragePath: config.ssdStoragePath,
    hddStoragePath: config.hddStoragePath,
    tempUploadPath: config.tempUploadPath,
    ssdWatermark: config.ssdWatermark,
  }),
);

app.use("/api/folders/*", authMiddleware);
app.route(
  "/api/folders",
  folderRoutes({
    db,
    ssdStoragePath: config.ssdStoragePath,
    hddStoragePath: config.hddStoragePath,
    tempUploadPath: config.tempUploadPath,
  }),
);

app.use("/api/files/*", authMiddleware);
app.route("/api/files", fileRoutes({ db, ssdStoragePath: config.ssdStoragePath }));

export default {
  port: config.port,
  fetch: app.fetch,
};
