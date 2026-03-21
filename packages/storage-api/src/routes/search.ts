import type { Database } from "@deniz-cloud/shared/db";
import { files, folders } from "@deniz-cloud/shared/db";
import type { AuthVariables } from "@deniz-cloud/shared/middleware";
import {
  buildFileDocument,
  buildFolderDocument,
  type MeiliSearch,
  STORAGE_INDEX_UID,
  searchStorageIndex,
} from "@deniz-cloud/shared/search";
import { ne } from "drizzle-orm";
import { Hono } from "hono";

interface SearchRouteDeps {
  db: Database;
  meili: MeiliSearch;
}

export function searchRoutes({ db, meili }: SearchRouteDeps) {
  const router = new Hono<{ Variables: AuthVariables }>();

  router.get("/", async (c) => {
    const user = c.get("user");
    const query = c.req.query("q")?.trim();

    if (!query || query.length < 2) {
      return c.json(
        {
          error: { code: "QUERY_TOO_SHORT", message: "Search query must be at least 2 characters" },
        },
        400,
      );
    }

    const scope = c.req.query("scope") === "shared" ? ("shared" as const) : ("user" as const);
    const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") ?? "20", 10) || 20));

    const result = await searchStorageIndex(meili, query, {
      scope,
      ownerId: scope === "user" ? user.id : undefined,
      page,
      hitsPerPage: limit,
    });

    return c.json({
      data: { hits: result.hits },
      pagination: {
        page: result.page,
        limit,
        total: result.totalHits,
        totalPages: result.totalPages,
      },
    });
  });

  router.post("/reindex", async (c) => {
    const user = c.get("user");
    if (user.role !== "superuser") {
      return c.json(
        { error: { code: "FORBIDDEN", message: "Only superusers can trigger reindex" } },
        403,
      );
    }

    const index = meili.index(STORAGE_INDEX_UID);
    await index.deleteAllDocuments().waitTask();

    const allFiles = await db
      .select({
        id: files.id,
        filename: files.filename,
        path: files.path,
        ownerId: files.ownerId,
        folderId: files.folderId,
        mimeType: files.mimeType,
        sizeBytes: files.sizeBytes,
        tier: files.tier,
        createdAt: files.createdAt,
        updatedAt: files.updatedAt,
      })
      .from(files);

    const allFolders = await db
      .select({
        id: folders.id,
        name: folders.name,
        path: folders.path,
        ownerId: folders.ownerId,
        parentId: folders.parentId,
        createdAt: folders.createdAt,
        updatedAt: folders.updatedAt,
      })
      .from(folders)
      .where(ne(folders.parentId, folders.id));

    const docs = [
      ...allFiles.map(buildFileDocument),
      ...allFolders.map(buildFolderDocument).filter((d): d is NonNullable<typeof d> => d !== null),
    ];

    const BATCH_SIZE = 1000;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = docs.slice(i, i + BATCH_SIZE);
      await index.addDocuments(batch).waitTask();
    }

    return c.json({ data: { indexed: docs.length } });
  });

  return router;
}
