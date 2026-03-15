import { rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { Database } from "@deniz-cloud/shared/db";
import { files, folders } from "@deniz-cloud/shared/db";
import type { AuthVariables } from "@deniz-cloud/shared/middleware";
import { count, desc, eq, like, sql } from "drizzle-orm";
import { Hono } from "hono";
import { deleteDir, ensureDir } from "../utils/fs";
import {
  buildProjectRootPath,
  buildUserRootPath,
  isSharedPath,
  joinPath,
  normalizeName,
  PathValidationError,
  resolveSsdDiskPath,
  SHARED_ROOT_PATH,
} from "../utils/path";
import { checkProjectScope } from "../utils/project-access";
import { ensureSharedFolder, initUserStorage } from "../utils/storage";

interface FolderRouteDeps {
  db: Database;
  ssdStoragePath: string;
  hddStoragePath: string;
  tempUploadPath: string;
}

function parentPath(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : filePath.slice(0, lastSlash);
}

export function folderRoutes({
  db,
  ssdStoragePath,
  hddStoragePath,
  tempUploadPath,
}: FolderRouteDeps) {
  const router = new Hono<{ Variables: AuthVariables }>();

  router.get("/roots", async (c) => {
    const user = c.get("user");
    const project = c.get("project");

    if (project) {
      const scopeCheck = checkProjectScope(c, buildProjectRootPath(project.slug), "storage:read");
      if (scopeCheck) return scopeCheck;

      const projectFolder = project.storageFolderId
        ? await db.query.folders.findFirst({
            where: eq(folders.id, project.storageFolderId),
          })
        : null;

      if (!projectFolder) {
        return c.json(
          {
            error: { code: "PROJECT_FOLDER_MISSING", message: "Project storage folder not found" },
          },
          500,
        );
      }

      return c.json({
        data: {
          projectRoot: {
            id: projectFolder.id,
            path: projectFolder.path,
            name: projectFolder.name,
          },
        },
      });
    }

    const storageConfig = { ssdStoragePath, hddStoragePath, tempUploadPath };
    const [userRoot, sharedRoot] = await Promise.all([
      initUserStorage(db, storageConfig, user.id),
      ensureSharedFolder(db, storageConfig),
    ]);

    return c.json({
      data: {
        userRoot: {
          id: userRoot.id,
          path: userRoot.path,
          name: userRoot.name,
        },
        sharedRoot: {
          id: sharedRoot.id,
          path: sharedRoot.path,
          name: sharedRoot.name,
        },
      },
    });
  });

  router.post("/", async (c) => {
    const user = c.get("user");
    const body = await c.req.json();
    const { name, parentId } = body;

    if (!name || typeof name !== "string") {
      return c.json({ error: { code: "MISSING_NAME", message: "Folder name is required" } }, 400);
    }
    if (!parentId || typeof parentId !== "string") {
      return c.json({ error: { code: "MISSING_PARENT_ID", message: "parentId is required" } }, 400);
    }

    const parent = await db.query.folders.findFirst({
      where: eq(folders.id, parentId),
    });
    if (!parent) {
      return c.json(
        { error: { code: "PARENT_NOT_FOUND", message: "Parent folder not found" } },
        404,
      );
    }

    const projectCheck = checkProjectScope(c, parent.path, "storage:write");
    if (projectCheck) return projectCheck;

    if (!c.get("project") && !isSharedPath(parent.path) && parent.ownerId !== user.id) {
      return c.json(
        { error: { code: "ACCESS_DENIED", message: "You do not have access to this folder" } },
        403,
      );
    }

    let normalizedName: string;
    try {
      normalizedName = normalizeName(name);
    } catch (err) {
      if (err instanceof PathValidationError) {
        return c.json({ error: { code: "INVALID_NAME", message: err.message } }, 400);
      }
      throw err;
    }

    const folderPath = joinPath(parent.path, normalizedName);

    const existing = await db.query.folders.findFirst({
      where: eq(folders.path, folderPath),
    });
    if (existing) {
      return c.json(
        { error: { code: "FOLDER_EXISTS", message: "A folder already exists at this path" } },
        409,
      );
    }

    const diskPath = resolveSsdDiskPath(ssdStoragePath, folderPath);
    await ensureDir(diskPath);

    const [created] = await db
      .insert(folders)
      .values({
        ownerId: user.id,
        parentId,
        path: folderPath,
        name: normalizedName,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to create folder");
    }

    return c.json(
      {
        data: {
          id: created.id,
          path: created.path,
          name: created.name,
          parentId: created.parentId,
          createdAt: created.createdAt,
        },
      },
      201,
    );
  });

  router.get("/:id", async (c) => {
    const user = c.get("user");
    const folderId = c.req.param("id");

    const folder = await db.query.folders.findFirst({
      where: eq(folders.id, folderId),
    });
    if (!folder) {
      return c.json({ error: { code: "FOLDER_NOT_FOUND", message: "Folder not found" } }, 404);
    }

    const projectCheck = checkProjectScope(c, folder.path, "storage:read");
    if (projectCheck) return projectCheck;

    if (!c.get("project") && !isSharedPath(folder.path) && folder.ownerId !== user.id) {
      return c.json(
        { error: { code: "ACCESS_DENIED", message: "You do not have access to this folder" } },
        403,
      );
    }

    return c.json({
      data: {
        id: folder.id,
        path: folder.path,
        name: folder.name,
        parentId: folder.parentId,
        ownerId: folder.ownerId,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
      },
    });
  });

  router.get("/:id/contents", async (c) => {
    const user = c.get("user");
    const folderId = c.req.param("id");

    const folder = await db.query.folders.findFirst({
      where: eq(folders.id, folderId),
    });
    if (!folder) {
      return c.json({ error: { code: "FOLDER_NOT_FOUND", message: "Folder not found" } }, 404);
    }

    const projectCheck = checkProjectScope(c, folder.path, "storage:read");
    if (projectCheck) return projectCheck;

    if (!c.get("project") && !isSharedPath(folder.path) && folder.ownerId !== user.id) {
      return c.json(
        { error: { code: "ACCESS_DENIED", message: "You do not have access to this folder" } },
        403,
      );
    }

    const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50));
    const offset = (page - 1) * limit;

    const [subfolders, fileList, fileCountResult] = await Promise.all([
      db
        .select({
          id: folders.id,
          name: folders.name,
          path: folders.path,
          parentId: folders.parentId,
          createdAt: folders.createdAt,
        })
        .from(folders)
        .where(eq(folders.parentId, folderId))
        .orderBy(folders.name),
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

    const total = fileCountResult[0]?.count ?? 0;

    return c.json({
      data: {
        folder: {
          id: folder.id,
          path: folder.path,
          name: folder.name,
          parentId: folder.parentId,
        },
        subfolders,
        files: fileList,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  });

  router.patch("/:id", async (c) => {
    const user = c.get("user");
    const folderId = c.req.param("id");
    const body = await c.req.json();
    const newName: string | undefined = body.name;
    const newParentId: string | undefined = body.parentId;

    if (!newName && !newParentId) {
      return c.json(
        { error: { code: "NOTHING_TO_UPDATE", message: "Provide name or parentId" } },
        400,
      );
    }

    const folder = await db.query.folders.findFirst({
      where: eq(folders.id, folderId),
    });
    if (!folder) {
      return c.json({ error: { code: "FOLDER_NOT_FOUND", message: "Folder not found" } }, 404);
    }

    const userRootPath = buildUserRootPath(user.id);
    if (folder.path === userRootPath || folder.path === SHARED_ROOT_PATH) {
      return c.json(
        { error: { code: "CANNOT_MODIFY_ROOT", message: "Cannot rename or move root folders" } },
        403,
      );
    }

    const patchProjectCheck = checkProjectScope(c, folder.path, "storage:write");
    if (patchProjectCheck) return patchProjectCheck;

    if (!c.get("project")) {
      if (!isSharedPath(folder.path) && folder.ownerId !== user.id) {
        return c.json(
          { error: { code: "ACCESS_DENIED", message: "You do not have access to this folder" } },
          403,
        );
      }
      if (isSharedPath(folder.path) && folder.ownerId !== user.id && user.role !== "superuser") {
        return c.json(
          {
            error: {
              code: "ACCESS_DENIED",
              message: "Only the owner or superuser can modify this folder",
            },
          },
          403,
        );
      }
    }

    let normalizedName: string;
    try {
      normalizedName = newName ? normalizeName(newName) : folder.name;
    } catch (err) {
      if (err instanceof PathValidationError) {
        return c.json({ error: { code: "INVALID_NAME", message: err.message } }, 400);
      }
      throw err;
    }

    let targetParentPath: string;
    let targetParentId: string | null;

    if (newParentId) {
      const newParent = await db.query.folders.findFirst({
        where: eq(folders.id, newParentId),
      });
      if (!newParent) {
        return c.json(
          { error: { code: "PARENT_NOT_FOUND", message: "Target parent folder not found" } },
          404,
        );
      }

      const targetProjectCheck = checkProjectScope(c, newParent.path, "storage:write");
      if (targetProjectCheck) return targetProjectCheck;

      if (!c.get("project") && !isSharedPath(newParent.path) && newParent.ownerId !== user.id) {
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

      if (newParent.path === folder.path || newParent.path.startsWith(`${folder.path}/`)) {
        return c.json(
          {
            error: {
              code: "CIRCULAR_MOVE",
              message: "Cannot move a folder into itself or its descendant",
            },
          },
          400,
        );
      }

      targetParentPath = newParent.path;
      targetParentId = newParent.id;
    } else {
      targetParentPath = parentPath(folder.path);
      targetParentId = folder.parentId;
    }

    const newPath = joinPath(targetParentPath, normalizedName);

    if (newPath !== folder.path) {
      const conflict = await db.query.folders.findFirst({
        where: eq(folders.path, newPath),
      });
      if (conflict) {
        return c.json(
          {
            error: { code: "FOLDER_EXISTS", message: "A folder already exists at the target path" },
          },
          409,
        );
      }
    }

    if (newPath === folder.path) {
      return c.json({
        data: { id: folder.id, path: folder.path, name: folder.name, parentId: folder.parentId },
      });
    }

    const oldPath = folder.path;
    const oldDiskPath = resolveSsdDiskPath(ssdStoragePath, oldPath);
    const newDiskPath = resolveSsdDiskPath(ssdStoragePath, newPath);

    await ensureDir(dirname(newDiskPath));
    await rename(oldDiskPath, newDiskPath);

    const oldSsdPrefix = resolveSsdDiskPath(ssdStoragePath, oldPath);
    const newSsdPrefix = resolveSsdDiskPath(ssdStoragePath, newPath);

    try {
      await db.transaction(async (tx) => {
        await tx
          .update(folders)
          .set({
            path: newPath,
            name: normalizedName,
            parentId: targetParentId,
            updatedAt: new Date(),
          })
          .where(eq(folders.id, folderId));

        await tx
          .update(folders)
          .set({
            path: sql`REPLACE(${folders.path}, ${oldPath || ""}, ${newPath})`,
            updatedAt: new Date(),
          })
          .where(like(folders.path, `${oldPath}/%`));

        await tx
          .update(files)
          .set({
            path: sql`REPLACE(${files.path}, ${oldPath || ""}, ${newPath})`,
            diskPath: sql`CASE WHEN ${files.tier} = 'ssd' THEN REPLACE(${files.diskPath}, ${oldSsdPrefix}, ${newSsdPrefix}) ELSE ${files.diskPath} END`,
            updatedAt: new Date(),
          })
          .where(like(files.path, `${oldPath}/%`));
      });
    } catch (err) {
      await rename(newDiskPath, oldDiskPath).catch(console.error);
      throw err;
    }

    return c.json({
      data: {
        id: folder.id,
        path: newPath,
        name: normalizedName,
        parentId: targetParentId,
      },
    });
  });

  router.delete("/:id", async (c) => {
    const user = c.get("user");
    const folderId = c.req.param("id");

    const folder = await db.query.folders.findFirst({
      where: eq(folders.id, folderId),
    });
    if (!folder) {
      return c.json({ error: { code: "FOLDER_NOT_FOUND", message: "Folder not found" } }, 404);
    }

    const userRootPath = buildUserRootPath(user.id);
    if (folder.path === userRootPath || folder.path === SHARED_ROOT_PATH) {
      return c.json(
        { error: { code: "CANNOT_DELETE_ROOT", message: "Cannot delete root folders" } },
        403,
      );
    }

    const deleteProjectCheck = checkProjectScope(c, folder.path, "storage:delete");
    if (deleteProjectCheck) return deleteProjectCheck;

    if (!c.get("project")) {
      if (!isSharedPath(folder.path) && folder.ownerId !== user.id) {
        return c.json(
          { error: { code: "ACCESS_DENIED", message: "You do not have access to this folder" } },
          403,
        );
      }
      if (isSharedPath(folder.path) && folder.ownerId !== user.id && user.role !== "superuser") {
        return c.json(
          {
            error: {
              code: "ACCESS_DENIED",
              message: "Only the owner or superuser can delete this folder",
            },
          },
          403,
        );
      }
    }

    const [childFolderCount, childFileCount] = await Promise.all([
      db.select({ count: count() }).from(folders).where(eq(folders.parentId, folderId)),
      db.select({ count: count() }).from(files).where(eq(files.folderId, folderId)),
    ]);

    const hasChildren = (childFolderCount[0]?.count ?? 0) > 0;
    const hasFiles = (childFileCount[0]?.count ?? 0) > 0;

    if (hasChildren || hasFiles) {
      return c.json(
        {
          error: {
            code: "FOLDER_NOT_EMPTY",
            message: "Folder is not empty. Delete all contents first.",
          },
        },
        409,
      );
    }

    const diskPath = resolveSsdDiskPath(ssdStoragePath, folder.path);
    await deleteDir(diskPath);
    await db.delete(folders).where(eq(folders.id, folderId));

    return c.json({ data: { id: folderId } });
  });

  return router;
}
