import { open, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Database, StorageTier } from "@deniz-cloud/shared/db";
import { files, folders, tusUploads } from "@deniz-cloud/shared/db";
import type { AuthVariables } from "@deniz-cloud/shared/middleware";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { computeChecksum, deleteFile, ensureDir, getDiskUsagePercent } from "../utils/fs";
import {
  isSharedPath,
  joinPath,
  normalizeFileName,
  PathValidationError,
  resolveHddDiskPath,
  resolveSsdDiskPath,
  validatePath,
} from "../utils/path";

const TUS_VERSION = "1.0.0";
const UPLOAD_EXPIRY_HOURS = 24;

interface UploadRouteDeps {
  db: Database;
  ssdStoragePath: string;
  hddStoragePath: string;
  tempUploadPath: string;
  ssdWatermark: number;
}

function parseTusMetadata(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of header.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx === -1) {
      result[trimmed] = "";
    } else {
      const key = trimmed.slice(0, spaceIdx);
      const value = atob(trimmed.slice(spaceIdx + 1));
      result[key] = value;
    }
  }
  return result;
}

function parentPath(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : filePath.slice(0, lastSlash);
}

export function uploadRoutes({
  db,
  ssdStoragePath,
  hddStoragePath,
  tempUploadPath,
  ssdWatermark,
}: UploadRouteDeps) {
  const router = new Hono<{ Variables: AuthVariables }>();

  router.use("*", async (c, next) => {
    await next();
    c.header("Tus-Resumable", TUS_VERSION);
  });

  router.options("/", (c) => {
    c.header("Tus-Version", TUS_VERSION);
    c.header("Tus-Extension", "creation,termination");
    return c.body(null, 204);
  });

  router.post("/", async (c) => {
    const user = c.get("user");

    const uploadLength = c.req.header("Upload-Length");
    if (!uploadLength) {
      return c.json(
        { error: { code: "MISSING_UPLOAD_LENGTH", message: "Upload-Length header is required" } },
        400,
      );
    }

    const sizeBytes = parseInt(uploadLength, 10);
    if (Number.isNaN(sizeBytes) || sizeBytes < 0) {
      return c.json(
        {
          error: {
            code: "INVALID_UPLOAD_LENGTH",
            message: "Upload-Length must be a non-negative integer",
          },
        },
        400,
      );
    }

    const metadataHeader = c.req.header("Upload-Metadata");
    if (!metadataHeader) {
      return c.json(
        { error: { code: "MISSING_METADATA", message: "Upload-Metadata header is required" } },
        400,
      );
    }

    const metadata = parseTusMetadata(metadataHeader);
    const { filename, filetype, targetFolder } = metadata;

    if (!filename) {
      return c.json(
        {
          error: {
            code: "MISSING_FILENAME",
            message: "filename is required in Upload-Metadata",
          },
        },
        400,
      );
    }
    if (!targetFolder) {
      return c.json(
        {
          error: {
            code: "MISSING_TARGET_FOLDER",
            message: "targetFolder is required in Upload-Metadata",
          },
        },
        400,
      );
    }

    try {
      validatePath(targetFolder);
    } catch (err) {
      if (err instanceof PathValidationError) {
        return c.json({ error: { code: "INVALID_PATH", message: err.message } }, 400);
      }
      throw err;
    }

    const folder = await db.query.folders.findFirst({
      where: eq(folders.path, targetFolder),
    });
    if (!folder) {
      return c.json(
        { error: { code: "FOLDER_NOT_FOUND", message: "Target folder does not exist" } },
        404,
      );
    }

    if (!isSharedPath(targetFolder) && folder.ownerId !== user.id) {
      return c.json(
        { error: { code: "ACCESS_DENIED", message: "You do not have access to this folder" } },
        403,
      );
    }

    const normalizedFilename = normalizeFileName(filename);
    const targetPath = joinPath(targetFolder, normalizedFilename);

    const existingFile = await db.query.files.findFirst({
      where: eq(files.path, targetPath),
    });
    if (existingFile) {
      return c.json(
        { error: { code: "FILE_EXISTS", message: "A file already exists at this path" } },
        409,
      );
    }

    const uploadId = crypto.randomUUID();
    const tempPath = join(tempUploadPath, `${uploadId}.part`);
    const expiresAt = new Date(Date.now() + UPLOAD_EXPIRY_HOURS * 60 * 60 * 1000);

    await Bun.write(tempPath, new Uint8Array(0));

    await db.insert(tusUploads).values({
      id: uploadId,
      ownerId: user.id,
      filename: normalizedFilename,
      targetPath,
      sizeBytes,
      mimeType: filetype || null,
      metadata,
      tempDiskPath: tempPath,
      expiresAt,
    });

    c.header("Location", `/api/uploads/${uploadId}`);
    c.header("Upload-Offset", "0");
    return c.body(null, 201);
  });

  router.on("HEAD", "/:id", async (c) => {
    const user = c.get("user");
    const uploadId = c.req.param("id");

    const upload = await db.query.tusUploads.findFirst({
      where: and(eq(tusUploads.id, uploadId), eq(tusUploads.ownerId, user.id)),
    });

    if (!upload) {
      return c.body(null, 404);
    }

    if (upload.status !== "in_progress") {
      return c.body(null, 410);
    }

    c.header("Upload-Offset", String(upload.bytesReceived));
    c.header("Upload-Length", String(upload.sizeBytes));
    c.header("Cache-Control", "no-store");
    return c.body(null, 200);
  });

  router.patch("/:id", async (c) => {
    const user = c.get("user");
    const uploadId = c.req.param("id");

    const contentType = c.req.header("Content-Type");
    if (contentType !== "application/offset+octet-stream") {
      return c.json(
        {
          error: {
            code: "INVALID_CONTENT_TYPE",
            message: "Content-Type must be application/offset+octet-stream",
          },
        },
        415,
      );
    }

    const offsetHeader = c.req.header("Upload-Offset");
    if (offsetHeader === undefined || offsetHeader === null) {
      return c.json(
        { error: { code: "MISSING_OFFSET", message: "Upload-Offset header is required" } },
        400,
      );
    }

    const clientOffset = parseInt(offsetHeader, 10);
    if (Number.isNaN(clientOffset) || clientOffset < 0) {
      return c.json(
        {
          error: {
            code: "INVALID_OFFSET",
            message: "Upload-Offset must be a non-negative integer",
          },
        },
        400,
      );
    }

    const upload = await db.query.tusUploads.findFirst({
      where: and(eq(tusUploads.id, uploadId), eq(tusUploads.ownerId, user.id)),
    });

    if (!upload) {
      return c.json({ error: { code: "UPLOAD_NOT_FOUND", message: "Upload not found" } }, 404);
    }

    if (upload.status !== "in_progress") {
      return c.json(
        { error: { code: "UPLOAD_FINISHED", message: "Upload is no longer in progress" } },
        410,
      );
    }

    if (new Date() > upload.expiresAt) {
      await db.update(tusUploads).set({ status: "expired" }).where(eq(tusUploads.id, uploadId));
      return c.json({ error: { code: "UPLOAD_EXPIRED", message: "Upload has expired" } }, 410);
    }

    if (clientOffset !== upload.bytesReceived) {
      return c.json(
        {
          error: {
            code: "OFFSET_MISMATCH",
            message: `Expected offset ${upload.bytesReceived}, got ${clientOffset}`,
          },
        },
        409,
      );
    }

    const body = c.req.raw.body;
    if (!body) {
      return c.json({ error: { code: "EMPTY_BODY", message: "Request body is empty" } }, 400);
    }

    const fileHandle = await open(upload.tempDiskPath, clientOffset === 0 ? "w" : "r+");
    const reader = body.getReader();
    let position = clientOffset;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const { bytesWritten } = await fileHandle.write(value, 0, value.length, position);
        position += bytesWritten;
      }
    } finally {
      await fileHandle.close();
    }

    if (position > upload.sizeBytes) {
      await deleteFile(upload.tempDiskPath);
      await db.update(tusUploads).set({ status: "expired" }).where(eq(tusUploads.id, uploadId));
      return c.json(
        { error: { code: "SIZE_EXCEEDED", message: "Upload exceeded declared size" } },
        413,
      );
    }

    await db
      .update(tusUploads)
      .set({ bytesReceived: position, updatedAt: new Date() })
      .where(eq(tusUploads.id, uploadId));

    if (position === upload.sizeBytes) {
      await finalizeUpload(db, { ssdStoragePath, hddStoragePath, ssdWatermark }, upload.id);
    }

    c.header("Upload-Offset", String(position));
    return c.body(null, 204);
  });

  router.delete("/:id", async (c) => {
    const user = c.get("user");
    const uploadId = c.req.param("id");

    const upload = await db.query.tusUploads.findFirst({
      where: and(eq(tusUploads.id, uploadId), eq(tusUploads.ownerId, user.id)),
    });

    if (!upload) {
      return c.json({ error: { code: "UPLOAD_NOT_FOUND", message: "Upload not found" } }, 404);
    }

    await deleteFile(upload.tempDiskPath);
    await db.delete(tusUploads).where(eq(tusUploads.id, uploadId));

    return c.body(null, 204);
  });

  return router;
}

interface FinalizeConfig {
  ssdStoragePath: string;
  hddStoragePath: string;
  ssdWatermark: number;
}

async function determineTier(config: FinalizeConfig): Promise<StorageTier> {
  try {
    const usage = await getDiskUsagePercent(config.ssdStoragePath);
    return usage >= config.ssdWatermark ? "hdd" : "ssd";
  } catch {
    return "ssd";
  }
}

async function moveToFinalPath(
  tempPath: string,
  finalPath: string,
  checksum: string,
): Promise<void> {
  try {
    await rename(tempPath, finalPath);
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "EXDEV") {
      await Bun.write(finalPath, Bun.file(tempPath));
      const finalChecksum = await computeChecksum(finalPath);
      if (finalChecksum !== checksum) {
        await deleteFile(finalPath);
        throw new Error("Checksum mismatch after cross-device file copy");
      }
      await deleteFile(tempPath);
    } else {
      throw err;
    }
  }
}

async function finalizeUpload(
  db: Database,
  config: FinalizeConfig,
  uploadId: string,
): Promise<void> {
  const upload = await db.query.tusUploads.findFirst({
    where: eq(tusUploads.id, uploadId),
  });
  if (!upload) return;

  const checksum = await computeChecksum(upload.tempDiskPath);
  const tier = await determineTier(config);

  const fileId = crypto.randomUUID();
  let finalDiskPath: string;

  if (tier === "ssd") {
    finalDiskPath = resolveSsdDiskPath(config.ssdStoragePath, upload.targetPath);
    await ensureDir(dirname(finalDiskPath));
  } else {
    finalDiskPath = resolveHddDiskPath(config.hddStoragePath, fileId);
    await ensureDir(config.hddStoragePath);
  }

  await moveToFinalPath(upload.tempDiskPath, finalDiskPath, checksum);

  const folderPath = parentPath(upload.targetPath);
  const folder = await db.query.folders.findFirst({
    where: eq(folders.path, folderPath),
  });
  if (!folder) {
    await deleteFile(finalDiskPath);
    throw new Error(`Parent folder not found in database: ${folderPath}`);
  }

  try {
    await db.transaction(async (tx) => {
      await tx.insert(files).values({
        id: fileId,
        ownerId: upload.ownerId,
        folderId: folder.id,
        filename: upload.filename,
        path: upload.targetPath,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        checksum,
        tier,
        diskPath: finalDiskPath,
      });

      await tx
        .update(tusUploads)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(tusUploads.id, uploadId));
    });
  } catch (err) {
    await deleteFile(finalDiskPath);
    throw err;
  }
}
