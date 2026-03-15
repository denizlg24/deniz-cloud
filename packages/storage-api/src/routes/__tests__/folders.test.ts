import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

interface TestUser {
  id: string;
  username: string;
  role: "user" | "superuser";
}

interface TestFolder {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface TestFile {
  id: string;
  filename: string;
  path: string;
  folderId: string;
}

interface FolderAppVariables {
  user: TestUser;
}

function isSharedPath(path: string): boolean {
  return path === "/shared" || path.startsWith("/shared/");
}

function buildUserRootPath(userId: string): string {
  return `/${userId}`;
}

const SHARED_ROOT_PATH = "/shared";

function normalizeName(name: string): string {
  const normalized = name
    .replace(/[\s-]+/g, "_")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  if (!normalized) throw new PathValidationError("Name is empty after normalization");
  if (/[<>:"|?*\\]/.test(normalized))
    throw new PathValidationError(`Path segment contains invalid characters: "${normalized}"`);
  if (normalized.length > 255) throw new PathValidationError("Path segment exceeds 255 characters");
  return normalized;
}

class PathValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathValidationError";
  }
}

function joinPath(...segments: string[]): string {
  const joined = `/${segments
    .map((s) => s.replace(/^\/|\/$/g, ""))
    .filter(Boolean)
    .join("/")}`;
  return joined === "" ? "/" : joined;
}

function parentPath(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : filePath.slice(0, lastSlash);
}

function createFolderApp(overrides: {
  currentUser?: TestUser;
  folders?: TestFolder[];
  files?: TestFile[];
  folderChildCounts?: Record<string, { folders: number; files: number }>;
  createResult?: TestFolder;
  createError?: Error;
}) {
  const app = new Hono<{ Variables: FolderAppVariables }>();
  const user = overrides.currentUser ?? {
    id: "user-1",
    username: "alice",
    role: "user" as const,
  };

  app.use("*", async (c, next) => {
    c.set("user", user);
    return next();
  });

  app.onError((err, c) => {
    return c.json({ error: { code: "INTERNAL", message: err.message } }, 500);
  });

  const findFolder = (id: string) => overrides.folders?.find((f) => f.id === id);
  const findFolderByPath = (path: string) => overrides.folders?.find((f) => f.path === path);

  // POST / — create folder
  app.post("/", async (c) => {
    const body = await c.req.json();
    const { name, parentId } = body;

    if (!name || typeof name !== "string") {
      return c.json({ error: { code: "MISSING_NAME", message: "Folder name is required" } }, 400);
    }
    if (!parentId || typeof parentId !== "string") {
      return c.json({ error: { code: "MISSING_PARENT_ID", message: "parentId is required" } }, 400);
    }

    const parent = findFolder(parentId);
    if (!parent) {
      return c.json(
        { error: { code: "PARENT_NOT_FOUND", message: "Parent folder not found" } },
        404,
      );
    }

    if (!isSharedPath(parent.path) && parent.ownerId !== user.id) {
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
    const existing = findFolderByPath(folderPath);
    if (existing) {
      return c.json(
        { error: { code: "FOLDER_EXISTS", message: "A folder already exists at this path" } },
        409,
      );
    }

    if (overrides.createError) throw overrides.createError;

    const created = overrides.createResult ?? {
      id: "new-folder",
      name: normalizedName,
      path: folderPath,
      parentId,
      ownerId: user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

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

  // GET /:id
  app.get("/:id", async (c) => {
    const folderId = c.req.param("id");
    const folder = findFolder(folderId);
    if (!folder) {
      return c.json({ error: { code: "FOLDER_NOT_FOUND", message: "Folder not found" } }, 404);
    }

    if (!isSharedPath(folder.path) && folder.ownerId !== user.id) {
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

  // GET /:id/contents
  app.get("/:id/contents", async (c) => {
    const folderId = c.req.param("id");
    const folder = findFolder(folderId);
    if (!folder) {
      return c.json({ error: { code: "FOLDER_NOT_FOUND", message: "Folder not found" } }, 404);
    }

    if (!isSharedPath(folder.path) && folder.ownerId !== user.id) {
      return c.json(
        { error: { code: "ACCESS_DENIED", message: "You do not have access to this folder" } },
        403,
      );
    }

    const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50));

    const subfolders = overrides.folders?.filter((f) => f.parentId === folderId) ?? [];
    const allFiles = overrides.files?.filter((f) => f.folderId === folderId) ?? [];
    const total = allFiles.length;
    const offset = (page - 1) * limit;
    const fileList = allFiles.slice(offset, offset + limit);

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

  // PATCH /:id
  app.patch("/:id", async (c) => {
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

    const folder = findFolder(folderId);
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
      const newParent = findFolder(newParentId);
      if (!newParent) {
        return c.json(
          { error: { code: "PARENT_NOT_FOUND", message: "Target parent folder not found" } },
          404,
        );
      }

      if (!isSharedPath(newParent.path) && newParent.ownerId !== user.id) {
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
      const conflict = findFolderByPath(newPath);
      if (conflict) {
        return c.json(
          {
            error: {
              code: "FOLDER_EXISTS",
              message: "A folder already exists at the target path",
            },
          },
          409,
        );
      }
    }

    if (newPath === folder.path) {
      return c.json({
        data: {
          id: folder.id,
          path: folder.path,
          name: folder.name,
          parentId: folder.parentId,
        },
      });
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

  // DELETE /:id
  app.delete("/:id", async (c) => {
    const folderId = c.req.param("id");
    const folder = findFolder(folderId);
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

    const counts = overrides.folderChildCounts?.[folderId] ?? {
      folders: 0,
      files: 0,
    };
    if (counts.folders > 0 || counts.files > 0) {
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

    return c.json({ data: { id: folderId } });
  });

  return app;
}

const now = new Date();

const userFolder: TestFolder = {
  id: "folder-1",
  name: "documents",
  path: "/user-1/documents",
  parentId: "root-1",
  ownerId: "user-1",
  createdAt: now,
  updatedAt: now,
};

const userRoot: TestFolder = {
  id: "root-1",
  name: "user-1",
  path: "/user-1",
  parentId: null,
  ownerId: "user-1",
  createdAt: now,
  updatedAt: now,
};

const sharedRoot: TestFolder = {
  id: "shared-root",
  name: "shared",
  path: "/shared",
  parentId: null,
  ownerId: "system",
  createdAt: now,
  updatedAt: now,
};

const sharedFolder: TestFolder = {
  id: "shared-1",
  name: "photos",
  path: "/shared/photos",
  parentId: "shared-root",
  ownerId: "user-1",
  createdAt: now,
  updatedAt: now,
};

const otherUserFolder: TestFolder = {
  id: "other-folder",
  name: "private",
  path: "/user-2/private",
  parentId: "root-2",
  ownerId: "user-2",
  createdAt: now,
  updatedAt: now,
};

describe("POST /folders — create", () => {
  it("creates folder and returns 201", async () => {
    const app = createFolderApp({
      folders: [userRoot],
    });
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "My Photos", parentId: "root-1" }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe("my_photos");
    expect(body.data.path).toBe("/user-1/my_photos");
    expect(body.data.parentId).toBe("root-1");
  });

  it("returns 400 when name is missing", async () => {
    const app = createFolderApp({ folders: [userRoot] });
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: "root-1" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("MISSING_NAME");
  });

  it("returns 400 when parentId is missing", async () => {
    const app = createFolderApp({ folders: [userRoot] });
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("MISSING_PARENT_ID");
  });

  it("returns 404 when parent folder does not exist", async () => {
    const app = createFolderApp({ folders: [] });
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test", parentId: "nonexistent" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("PARENT_NOT_FOUND");
  });

  it("returns 403 when user does not own the parent folder", async () => {
    const app = createFolderApp({
      folders: [otherUserFolder],
    });
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test", parentId: "other-folder" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("ACCESS_DENIED");
  });

  it("allows creating under shared path even if not owner", async () => {
    const app = createFolderApp({
      folders: [sharedRoot],
    });
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "community", parentId: "shared-root" }),
    });
    expect(res.status).toBe(201);
  });

  it("returns 409 when folder already exists at path", async () => {
    const existingFolder: TestFolder = {
      id: "existing",
      name: "documents",
      path: "/user-1/documents",
      parentId: "root-1",
      ownerId: "user-1",
      createdAt: now,
      updatedAt: now,
    };
    const app = createFolderApp({
      folders: [userRoot, existingFolder],
    });
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "documents", parentId: "root-1" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("FOLDER_EXISTS");
  });

  it("returns 400 for invalid folder name (special chars)", async () => {
    const app = createFolderApp({ folders: [userRoot] });
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: 'file<script>"', parentId: "root-1" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_NAME");
  });

  it("normalizes name (camelCase → snake_case)", async () => {
    const app = createFolderApp({ folders: [userRoot] });
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "MyDocuments", parentId: "root-1" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe("my_documents");
  });
});

describe("GET /folders/:id", () => {
  it("returns folder details", async () => {
    const app = createFolderApp({ folders: [userFolder] });
    const res = await app.request("/folder-1");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe("folder-1");
    expect(body.data.name).toBe("documents");
    expect(body.data.path).toBe("/user-1/documents");
  });

  it("returns 404 for non-existent folder", async () => {
    const app = createFolderApp({ folders: [] });
    const res = await app.request("/nonexistent");

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("FOLDER_NOT_FOUND");
  });

  it("returns 403 when user does not own the folder", async () => {
    const app = createFolderApp({ folders: [otherUserFolder] });
    const res = await app.request("/other-folder");

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("ACCESS_DENIED");
  });

  it("allows access to shared folders regardless of owner", async () => {
    const app = createFolderApp({ folders: [sharedFolder] });
    const res = await app.request("/shared-1");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.path).toBe("/shared/photos");
  });
});

describe("GET /folders/:id/contents", () => {
  it("returns subfolders and files with pagination", async () => {
    const child: TestFolder = {
      id: "child-1",
      name: "sub",
      path: "/user-1/documents/sub",
      parentId: "folder-1",
      ownerId: "user-1",
      createdAt: now,
      updatedAt: now,
    };
    const file: TestFile = {
      id: "file-1",
      filename: "readme.txt",
      path: "/user-1/documents/readme.txt",
      folderId: "folder-1",
    };
    const app = createFolderApp({
      folders: [userFolder, child],
      files: [file],
    });
    const res = await app.request("/folder-1/contents");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.folder.id).toBe("folder-1");
    expect(body.data.subfolders).toHaveLength(1);
    expect(body.data.files).toHaveLength(1);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.total).toBe(1);
  });

  it("returns 404 for non-existent folder", async () => {
    const app = createFolderApp({ folders: [] });
    const res = await app.request("/nonexistent/contents");
    expect(res.status).toBe(404);
  });

  it("returns 403 when user does not own the folder", async () => {
    const app = createFolderApp({ folders: [otherUserFolder] });
    const res = await app.request("/other-folder/contents");
    expect(res.status).toBe(403);
  });

  it("respects pagination parameters", async () => {
    const files: TestFile[] = Array.from({ length: 5 }, (_, i) => ({
      id: `file-${i}`,
      filename: `file${i}.txt`,
      path: `/user-1/documents/file${i}.txt`,
      folderId: "folder-1",
    }));
    const app = createFolderApp({
      folders: [userFolder],
      files,
    });

    const res = await app.request("/folder-1/contents?page=2&limit=2");
    const body = await res.json();
    expect(body.data.files).toHaveLength(2);
    expect(body.pagination.page).toBe(2);
    expect(body.pagination.limit).toBe(2);
    expect(body.pagination.total).toBe(5);
    expect(body.pagination.totalPages).toBe(3);
  });

  it("returns empty results for empty folder", async () => {
    const app = createFolderApp({
      folders: [userFolder],
      files: [],
    });
    const res = await app.request("/folder-1/contents");
    const body = await res.json();
    expect(body.data.subfolders).toHaveLength(0);
    expect(body.data.files).toHaveLength(0);
    expect(body.pagination.total).toBe(0);
  });
});

describe("PATCH /folders/:id — rename", () => {
  it("renames a folder", async () => {
    const app = createFolderApp({ folders: [userFolder] });
    const res = await app.request("/folder-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "new-name" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe("new_name");
    expect(body.data.path).toBe("/user-1/new_name");
  });

  it("returns 400 when neither name nor parentId is provided", async () => {
    const app = createFolderApp({ folders: [userFolder] });
    const res = await app.request("/folder-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("NOTHING_TO_UPDATE");
  });

  it("returns 404 for non-existent folder", async () => {
    const app = createFolderApp({ folders: [] });
    const res = await app.request("/nonexistent", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 403 when trying to rename user root folder", async () => {
    const app = createFolderApp({ folders: [userRoot] });
    const res = await app.request("/root-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "new-root" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("CANNOT_MODIFY_ROOT");
  });

  it("returns 403 when trying to rename shared root folder", async () => {
    const app = createFolderApp({ folders: [sharedRoot] });
    const res = await app.request("/shared-root", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "new-shared" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("CANNOT_MODIFY_ROOT");
  });

  it("returns 403 when non-owner tries to rename user folder", async () => {
    const app = createFolderApp({ folders: [otherUserFolder] });
    const res = await app.request("/other-folder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "hacked" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid name", async () => {
    const app = createFolderApp({ folders: [userFolder] });
    const res = await app.request("/folder-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "bad<name>" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_NAME");
  });

  it("returns no-op when resulting path is unchanged", async () => {
    const app = createFolderApp({ folders: [userFolder] });
    const res = await app.request("/folder-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "documents" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.path).toBe("/user-1/documents");
  });
});

describe("PATCH /folders/:id — move", () => {
  const destFolder: TestFolder = {
    id: "dest-1",
    name: "archive",
    path: "/user-1/archive",
    parentId: "root-1",
    ownerId: "user-1",
    createdAt: now,
    updatedAt: now,
  };

  it("moves folder to new parent", async () => {
    const app = createFolderApp({ folders: [userFolder, destFolder] });
    const res = await app.request("/folder-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: "dest-1" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.path).toBe("/user-1/archive/documents");
    expect(body.data.parentId).toBe("dest-1");
  });

  it("returns 404 when target parent does not exist", async () => {
    const app = createFolderApp({ folders: [userFolder] });
    const res = await app.request("/folder-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: "nonexistent" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("PARENT_NOT_FOUND");
  });

  it("returns 403 when user does not own the target parent", async () => {
    const otherParent: TestFolder = {
      id: "other-parent",
      name: "their-folder",
      path: "/user-2/their-folder",
      parentId: "root-2",
      ownerId: "user-2",
      createdAt: now,
      updatedAt: now,
    };
    const app = createFolderApp({ folders: [userFolder, otherParent] });
    const res = await app.request("/folder-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: "other-parent" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 for circular move (into itself)", async () => {
    const app = createFolderApp({ folders: [userFolder] });
    const res = await app.request("/folder-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: "folder-1" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("CIRCULAR_MOVE");
  });

  it("returns 400 for circular move (into descendant)", async () => {
    const childFolder: TestFolder = {
      id: "child-1",
      name: "child",
      path: "/user-1/documents/child",
      parentId: "folder-1",
      ownerId: "user-1",
      createdAt: now,
      updatedAt: now,
    };
    const app = createFolderApp({ folders: [userFolder, childFolder] });
    const res = await app.request("/folder-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: "child-1" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("CIRCULAR_MOVE");
  });

  it("returns 409 when folder already exists at target path", async () => {
    const conflicting: TestFolder = {
      id: "conflict",
      name: "documents",
      path: "/user-1/archive/documents",
      parentId: "dest-1",
      ownerId: "user-1",
      createdAt: now,
      updatedAt: now,
    };
    const app = createFolderApp({
      folders: [userFolder, destFolder, conflicting],
    });
    const res = await app.request("/folder-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: "dest-1" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("FOLDER_EXISTS");
  });

  it("rename and move simultaneously", async () => {
    const app = createFolderApp({ folders: [userFolder, destFolder] });
    const res = await app.request("/folder-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "renamed", parentId: "dest-1" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.path).toBe("/user-1/archive/renamed");
    expect(body.data.name).toBe("renamed");
    expect(body.data.parentId).toBe("dest-1");
  });
});

describe("DELETE /folders/:id", () => {
  it("deletes an empty folder", async () => {
    const app = createFolderApp({ folders: [userFolder] });
    const res = await app.request("/folder-1", { method: "DELETE" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe("folder-1");
  });

  it("returns 404 for non-existent folder", async () => {
    const app = createFolderApp({ folders: [] });
    const res = await app.request("/nonexistent", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("returns 403 when trying to delete user root", async () => {
    const app = createFolderApp({ folders: [userRoot] });
    const res = await app.request("/root-1", { method: "DELETE" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("CANNOT_DELETE_ROOT");
  });

  it("returns 403 when trying to delete shared root", async () => {
    const app = createFolderApp({ folders: [sharedRoot] });
    const res = await app.request("/shared-root", { method: "DELETE" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("CANNOT_DELETE_ROOT");
  });

  it("returns 403 when non-owner tries to delete user folder", async () => {
    const app = createFolderApp({ folders: [otherUserFolder] });
    const res = await app.request("/other-folder", { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  it("returns 409 when folder has child folders", async () => {
    const app = createFolderApp({
      folders: [userFolder],
      folderChildCounts: { "folder-1": { folders: 2, files: 0 } },
    });
    const res = await app.request("/folder-1", { method: "DELETE" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("FOLDER_NOT_EMPTY");
  });

  it("returns 409 when folder has files", async () => {
    const app = createFolderApp({
      folders: [userFolder],
      folderChildCounts: { "folder-1": { folders: 0, files: 3 } },
    });
    const res = await app.request("/folder-1", { method: "DELETE" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("FOLDER_NOT_EMPTY");
  });

  it("returns 409 when folder has both children and files", async () => {
    const app = createFolderApp({
      folders: [userFolder],
      folderChildCounts: { "folder-1": { folders: 1, files: 5 } },
    });
    const res = await app.request("/folder-1", { method: "DELETE" });
    expect(res.status).toBe(409);
  });

  it("allows owner to delete shared subfolder", async () => {
    const app = createFolderApp({ folders: [sharedFolder] });
    const res = await app.request("/shared-1", { method: "DELETE" });
    expect(res.status).toBe(200);
  });

  it("returns 403 when non-owner non-superuser deletes shared subfolder", async () => {
    const folder: TestFolder = {
      ...sharedFolder,
      ownerId: "user-2",
    };
    const app = createFolderApp({ folders: [folder] });
    const res = await app.request("/shared-1", { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  it("allows superuser to delete shared subfolder they don't own", async () => {
    const folder: TestFolder = {
      ...sharedFolder,
      ownerId: "user-2",
    };
    const app = createFolderApp({
      currentUser: { id: "admin-1", username: "admin", role: "superuser" },
      folders: [folder],
    });
    const res = await app.request("/shared-1", { method: "DELETE" });
    expect(res.status).toBe(200);
  });
});

describe("shared path access control", () => {
  it("non-owner can read shared path folders", async () => {
    const app = createFolderApp({
      currentUser: { id: "user-99", username: "stranger", role: "user" },
      folders: [sharedFolder],
    });
    const res = await app.request("/shared-1");
    expect(res.status).toBe(200);
  });

  it("non-owner non-superuser cannot modify shared folders they don't own", async () => {
    const folder: TestFolder = { ...sharedFolder, ownerId: "user-2" };
    const app = createFolderApp({
      currentUser: { id: "user-99", username: "stranger", role: "user" },
      folders: [folder],
    });
    const res = await app.request("/shared-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "hacked" }),
    });
    expect(res.status).toBe(403);
  });

  it("superuser can modify shared folders they don't own", async () => {
    const folder: TestFolder = { ...sharedFolder, ownerId: "user-2" };
    const app = createFolderApp({
      currentUser: { id: "admin-1", username: "admin", role: "superuser" },
      folders: [folder],
    });
    const res = await app.request("/shared-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "renamed" }),
    });
    expect(res.status).toBe(200);
  });
});

describe("parentPath helper", () => {
  it("returns parent for nested path", () => {
    expect(parentPath("/user-1/documents/sub")).toBe("/user-1/documents");
  });

  it("returns root for top-level path", () => {
    expect(parentPath("/documents")).toBe("/");
  });

  it("returns root for root path", () => {
    expect(parentPath("/")).toBe("/");
  });
});

describe("name normalization in folder operations", () => {
  it("converts spaces to underscores", () => {
    expect(normalizeName("my folder")).toBe("my_folder");
  });

  it("converts hyphens to underscores", () => {
    expect(normalizeName("my-folder")).toBe("my_folder");
  });

  it("converts camelCase to snake_case", () => {
    expect(normalizeName("myFolder")).toBe("my_folder");
  });

  it("collapses multiple underscores", () => {
    expect(normalizeName("my___folder")).toBe("my_folder");
  });

  it("trims leading/trailing underscores", () => {
    expect(normalizeName("_folder_")).toBe("folder");
  });

  it("throws for empty result after normalization", () => {
    expect(() => normalizeName("___")).toThrow("empty after normalization");
  });

  it("throws for names with forbidden characters", () => {
    expect(() => normalizeName('test"name')).toThrow("invalid characters");
  });
});
