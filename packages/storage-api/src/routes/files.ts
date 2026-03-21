import { rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { Database } from "@deniz-cloud/shared/db";
import { files, folders } from "@deniz-cloud/shared/db";
import type { AuthVariables } from "@deniz-cloud/shared/middleware";
import {
  buildFileDocument,
  indexStorageDocuments,
  type MeiliSearch,
  removeStorageDocuments,
} from "@deniz-cloud/shared/search";
import type { SafeUser } from "@deniz-cloud/shared/types";
import { count, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { deleteFile, ensureDir } from "../utils/fs";
import {
  isSharedPath,
  joinPath,
  normalizeFileName,
  PathValidationError,
  resolveSsdDiskPath,
} from "../utils/path";
import { checkProjectScope } from "../utils/project-access";
import { generateShareToken, isValidExpiresIn } from "../utils/share";

interface FileRouteDeps {
  db: Database;
  meili: MeiliSearch;
  ssdStoragePath: string;
  jwtSecret: string;
}

function canModify(user: SafeUser, resourceOwnerId: string): boolean {
  if (user.id === resourceOwnerId) return true;
  if (user.role === "superuser") return true;
  return false;
}

function parentPath(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : filePath.slice(0, lastSlash);
}

export function fileRoutes({ db, meili, ssdStoragePath, jwtSecret }: FileRouteDeps) {
  const router = new Hono<{ Variables: AuthVariables }>();

  router.get("/", async (c) => {
    const user = c.get("user");
    const folderId = c.req.query("folderId");

    if (!folderId) {
      return c.json(
        {
          error: {
            code: "MISSING_FOLDER_ID",
            message: "folderId query parameter is required",
          },
        },
        400,
      );
    }

    const folder = await db.query.folders.findFirst({
      where: eq(folders.id, folderId),
    });
    if (!folder) {
      return c.json({ error: { code: "FOLDER_NOT_FOUND", message: "Folder not found" } }, 404);
    }

    const listProjectCheck = checkProjectScope(c, folder.path, "storage:read");
    if (listProjectCheck) return listProjectCheck;

    if (!c.get("project") && !isSharedPath(folder.path) && folder.ownerId !== user.id) {
      return c.json(
        { error: { code: "ACCESS_DENIED", message: "You do not have access to this folder" } },
        403,
      );
    }

    const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50));
    const offset = (page - 1) * limit;

    const [fileList, countResult] = await Promise.all([
      db
        .select({
          id: files.id,
          filename: files.filename,
          path: files.path,
          mimeType: files.mimeType,
          sizeBytes: files.sizeBytes,
          tier: files.tier,
          createdAt: files.createdAt,
          updatedAt: files.updatedAt,
        })
        .from(files)
        .where(eq(files.folderId, folderId))
        .orderBy(desc(files.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: count() }).from(files).where(eq(files.folderId, folderId)),
    ]);

    const total = countResult[0]?.count ?? 0;

    return c.json({
      data: fileList,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  });

  router.get("/:id", async (c) => {
    const user = c.get("user");
    const fileId = c.req.param("id");

    const file = await db.query.files.findFirst({
      where: eq(files.id, fileId),
    });
    if (!file) {
      return c.json({ error: { code: "FILE_NOT_FOUND", message: "File not found" } }, 404);
    }

    const metaProjectCheck = checkProjectScope(c, file.path, "storage:read");
    if (metaProjectCheck) return metaProjectCheck;

    if (!c.get("project") && !isSharedPath(file.path) && file.ownerId !== user.id) {
      return c.json(
        { error: { code: "ACCESS_DENIED", message: "You do not have access to this file" } },
        403,
      );
    }

    return c.json({
      data: {
        id: file.id,
        filename: file.filename,
        path: file.path,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        checksum: file.checksum,
        tier: file.tier,
        lastAccessedAt: file.lastAccessedAt,
        accessCount: file.accessCount,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
      },
    });
  });

  router.get("/:id/download", async (c) => {
    const user = c.get("user");
    const fileId = c.req.param("id");

    const file = await db.query.files.findFirst({
      where: eq(files.id, fileId),
    });
    if (!file) {
      return c.json({ error: { code: "FILE_NOT_FOUND", message: "File not found" } }, 404);
    }

    const dlProjectCheck = checkProjectScope(c, file.path, "storage:read");
    if (dlProjectCheck) return dlProjectCheck;

    if (!c.get("project") && !isSharedPath(file.path) && file.ownerId !== user.id) {
      return c.json(
        { error: { code: "ACCESS_DENIED", message: "You do not have access to this file" } },
        403,
      );
    }

    void db
      .update(files)
      .set({
        lastAccessedAt: new Date(),
        accessCount: sql`${files.accessCount} + 1`,
      })
      .where(eq(files.id, fileId))
      .then(() => {}, console.error);

    const bunFile = Bun.file(file.diskPath);
    const contentType = file.mimeType || "application/octet-stream";
    const forceDownload = c.req.query("download") !== undefined;
    const disposition = forceDownload ? "attachment" : "inline";

    const range = c.req.header("Range");
    if (range) {
      const match = range.match(/^bytes=(\d+)-(\d*)$/);
      if (match?.[1]) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : file.sizeBytes - 1;

        if (start >= file.sizeBytes || end >= file.sizeBytes || start > end) {
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${file.sizeBytes}` },
          });
        }

        return new Response(bunFile.slice(start, end + 1).stream(), {
          status: 206,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(end - start + 1),
            "Content-Range": `bytes ${start}-${end}/${file.sizeBytes}`,
            "Accept-Ranges": "bytes",
          },
        });
      }
    }

    return new Response(bunFile.stream(), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(file.sizeBytes),
        "Content-Disposition": `${disposition}; filename="${file.filename}"`,
        "Accept-Ranges": "bytes",
      },
    });
  });

  router.delete("/:id", async (c) => {
    const user = c.get("user");
    const fileId = c.req.param("id");

    const file = await db.query.files.findFirst({
      where: eq(files.id, fileId),
    });
    if (!file) {
      return c.json({ error: { code: "FILE_NOT_FOUND", message: "File not found" } }, 404);
    }

    const delProjectCheck = checkProjectScope(c, file.path, "storage:delete");
    if (delProjectCheck) return delProjectCheck;

    if (!c.get("project") && !canModify(user, file.ownerId)) {
      return c.json(
        {
          error: {
            code: "ACCESS_DENIED",
            message: "You do not have permission to delete this file",
          },
        },
        403,
      );
    }

    await deleteFile(file.diskPath);
    await db.delete(files).where(eq(files.id, fileId));

    void removeStorageDocuments(meili, [fileId]).catch(console.error);

    return c.json({ data: { id: fileId } });
  });

  router.patch("/:id", async (c) => {
    const user = c.get("user");
    const fileId = c.req.param("id");
    const body = await c.req.json();
    const newFilename: string | undefined = body.filename;
    const newFolderId: string | undefined = body.folderId;

    if (!newFilename && !newFolderId) {
      return c.json(
        { error: { code: "NOTHING_TO_UPDATE", message: "Provide filename or folderId" } },
        400,
      );
    }

    const file = await db.query.files.findFirst({
      where: eq(files.id, fileId),
    });
    if (!file) {
      return c.json({ error: { code: "FILE_NOT_FOUND", message: "File not found" } }, 404);
    }

    const modProjectCheck = checkProjectScope(c, file.path, "storage:write");
    if (modProjectCheck) return modProjectCheck;

    if (!c.get("project") && !canModify(user, file.ownerId)) {
      return c.json(
        {
          error: {
            code: "ACCESS_DENIED",
            message: "You do not have permission to modify this file",
          },
        },
        403,
      );
    }

    let normalizedFilename: string;
    try {
      normalizedFilename = newFilename ? normalizeFileName(newFilename) : file.filename;
    } catch (err) {
      if (err instanceof PathValidationError) {
        return c.json({ error: { code: "INVALID_NAME", message: err.message } }, 400);
      }
      throw err;
    }

    let targetFolderPath: string;
    let targetFolderId: string;

    if (newFolderId) {
      const targetFolder = await db.query.folders.findFirst({
        where: eq(folders.id, newFolderId),
      });
      if (!targetFolder) {
        return c.json(
          { error: { code: "FOLDER_NOT_FOUND", message: "Target folder not found" } },
          404,
        );
      }

      const moveTargetCheck = checkProjectScope(c, targetFolder.path, "storage:write");
      if (moveTargetCheck) return moveTargetCheck;

      if (
        !c.get("project") &&
        !isSharedPath(targetFolder.path) &&
        targetFolder.ownerId !== user.id
      ) {
        return c.json(
          {
            error: {
              code: "ACCESS_DENIED",
              message: "You do not have access to the target folder",
            },
          },
          403,
        );
      }

      targetFolderPath = targetFolder.path;
      targetFolderId = targetFolder.id;
    } else {
      targetFolderPath = parentPath(file.path);
      targetFolderId = file.folderId;
    }

    const newPath = joinPath(targetFolderPath, normalizedFilename);

    if (newPath !== file.path) {
      const conflict = await db.query.files.findFirst({
        where: eq(files.path, newPath),
      });
      if (conflict) {
        return c.json(
          { error: { code: "FILE_EXISTS", message: "A file already exists at the target path" } },
          409,
        );
      }
    }

    if (newPath === file.path) {
      return c.json({
        data: { id: file.id, filename: file.filename, path: file.path, folderId: file.folderId },
      });
    }

    let newDiskPath = file.diskPath;

    if (file.tier === "ssd") {
      const oldDiskPath = file.diskPath;
      newDiskPath = resolveSsdDiskPath(ssdStoragePath, newPath);
      await ensureDir(dirname(newDiskPath));
      await rename(oldDiskPath, newDiskPath);
    }

    try {
      await db
        .update(files)
        .set({
          filename: normalizedFilename,
          path: newPath,
          folderId: targetFolderId,
          diskPath: newDiskPath,
          updatedAt: new Date(),
        })
        .where(eq(files.id, fileId));
    } catch (err) {
      if (file.tier === "ssd" && newDiskPath !== file.diskPath) {
        await rename(newDiskPath, file.diskPath).catch(console.error);
      }
      throw err;
    }

    const now = new Date();
    void indexStorageDocuments(meili, [
      buildFileDocument({
        id: file.id,
        filename: normalizedFilename,
        path: newPath,
        ownerId: file.ownerId,
        folderId: targetFolderId,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        tier: file.tier,
        createdAt: file.createdAt,
        updatedAt: now,
      }),
    ]).catch(console.error);

    return c.json({
      data: {
        id: file.id,
        filename: normalizedFilename,
        path: newPath,
        folderId: targetFolderId,
      },
    });
  });

  router.post("/:id/share", async (c) => {
    const user = c.get("user");
    const fileId = c.req.param("id");
    const body = await c.req.json();
    const expiresIn: string = body.expiresIn;

    if (!expiresIn || !isValidExpiresIn(expiresIn)) {
      return c.json(
        {
          error: {
            code: "INVALID_EXPIRY",
            message: "expiresIn must be one of: 30m, 1d, 7d, 30d, never",
          },
        },
        400,
      );
    }

    const file = await db.query.files.findFirst({
      where: eq(files.id, fileId),
    });
    if (!file) {
      return c.json({ error: { code: "FILE_NOT_FOUND", message: "File not found" } }, 404);
    }

    const shareProjectCheck = checkProjectScope(c, file.path, "storage:read");
    if (shareProjectCheck) return shareProjectCheck;

    if (!c.get("project") && !canModify(user, file.ownerId)) {
      return c.json(
        {
          error: {
            code: "ACCESS_DENIED",
            message: "You do not have permission to share this file",
          },
        },
        403,
      );
    }

    const token = generateShareToken(fileId, expiresIn, jwtSecret);

    return c.json({
      data: { token },
    });
  });

  return router;
}
