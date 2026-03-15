import type { Database } from "@deniz-cloud/shared/db";
import { files } from "@deniz-cloud/shared/db";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { verifyShareToken } from "../utils/share";

interface ShareRouteDeps {
  db: Database;
  jwtSecret: string;
}

export function shareRoutes({ db, jwtSecret }: ShareRouteDeps) {
  const router = new Hono();

  router.get("/:token", async (c) => {
    const token = c.req.param("token");
    const payload = verifyShareToken(token, jwtSecret);

    if (!payload) {
      return c.json(
        { error: { code: "INVALID_SHARE_LINK", message: "Invalid or expired share link" } },
        403,
      );
    }

    const file = await db.query.files.findFirst({
      where: eq(files.id, payload.fileId),
    });

    if (!file) {
      return c.json({ error: { code: "FILE_NOT_FOUND", message: "File not found" } }, 404);
    }

    void db
      .update(files)
      .set({
        lastAccessedAt: new Date(),
        accessCount: sql`${files.accessCount} + 1`,
      })
      .where(eq(files.id, file.id))
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

  return router;
}
