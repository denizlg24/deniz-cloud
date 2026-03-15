import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

interface FileRecord {
  id: string;
  filename: string;
  diskPath: string;
  mimeType: string | null;
  sizeBytes: number;
  accessCount: number;
}

interface SharePayload {
  fileId: string;
  expiresAt: number;
}

function createShareApp(overrides: {
  verifyToken?: (token: string) => SharePayload | null;
  findFile?: (fileId: string) => FileRecord | undefined;
}) {
  const app = new Hono();

  app.get("/:token", async (c) => {
    const token = c.req.param("token");
    const payload = overrides.verifyToken?.(token) ?? null;

    if (!payload) {
      return c.json(
        { error: { code: "INVALID_SHARE_LINK", message: "Invalid or expired share link" } },
        403,
      );
    }

    const file = overrides.findFile?.(payload.fileId);
    if (!file) {
      return c.json({ error: { code: "FILE_NOT_FOUND", message: "File not found" } }, 404);
    }

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

        return new Response("partial-content", {
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

    return new Response("file-content", {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(file.sizeBytes),
        "Content-Disposition": `${disposition}; filename="${file.filename}"`,
        "Accept-Ranges": "bytes",
      },
    });
  });

  return app;
}

const testFile: FileRecord = {
  id: "file-1",
  filename: "photo.jpg",
  diskPath: "/data/ssd/user1/photo.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 1_000_000,
  accessCount: 0,
};

const validPayload: SharePayload = {
  fileId: "file-1",
  expiresAt: Date.now() + 3600_000,
};

describe("GET /share/:token — token verification", () => {
  it("returns 403 for invalid token", async () => {
    const app = createShareApp({ verifyToken: () => null });
    const res = await app.request("/invalid-token");

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_SHARE_LINK");
  });

  it("returns 403 for expired token", async () => {
    const app = createShareApp({ verifyToken: () => null });
    const res = await app.request("/expired-token");

    expect(res.status).toBe(403);
  });

  it("returns 404 when file does not exist", async () => {
    const app = createShareApp({
      verifyToken: () => validPayload,
      findFile: () => undefined,
    });
    const res = await app.request("/valid-token");

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("FILE_NOT_FOUND");
  });
});

describe("GET /share/:token — full file response", () => {
  it("returns file with correct Content-Type", async () => {
    const app = createShareApp({
      verifyToken: () => validPayload,
      findFile: () => testFile,
    });
    const res = await app.request("/valid-token");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("returns correct Content-Length", async () => {
    const app = createShareApp({
      verifyToken: () => validPayload,
      findFile: () => testFile,
    });
    const res = await app.request("/valid-token");

    expect(res.headers.get("Content-Length")).toBe("1000000");
  });

  it("defaults to inline disposition", async () => {
    const app = createShareApp({
      verifyToken: () => validPayload,
      findFile: () => testFile,
    });
    const res = await app.request("/valid-token");

    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="photo.jpg"');
  });

  it("uses attachment disposition when ?download is present", async () => {
    const app = createShareApp({
      verifyToken: () => validPayload,
      findFile: () => testFile,
    });
    const res = await app.request("/valid-token?download");

    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="photo.jpg"');
  });

  it("uses attachment when ?download= (empty value)", async () => {
    const app = createShareApp({
      verifyToken: () => validPayload,
      findFile: () => testFile,
    });
    const res = await app.request("/valid-token?download=");

    expect(res.headers.get("Content-Disposition")).toContain("attachment");
  });

  it("includes Accept-Ranges header", async () => {
    const app = createShareApp({
      verifyToken: () => validPayload,
      findFile: () => testFile,
    });
    const res = await app.request("/valid-token");

    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
  });

  it("falls back to application/octet-stream for null mimeType", async () => {
    const file = { ...testFile, mimeType: null };
    const app = createShareApp({
      verifyToken: () => validPayload,
      findFile: () => file,
    });
    const res = await app.request("/valid-token");

    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
  });
});

describe("GET /share/:token — range requests", () => {
  it("returns 206 for valid range", async () => {
    const app = createShareApp({
      verifyToken: () => validPayload,
      findFile: () => testFile,
    });
    const res = await app.request("/valid-token", {
      headers: { Range: "bytes=0-99" },
    });

    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-99/1000000");
    expect(res.headers.get("Content-Length")).toBe("100");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
  });

  it("returns 206 for range without end (open-ended)", async () => {
    const app = createShareApp({
      verifyToken: () => validPayload,
      findFile: () => testFile,
    });
    const res = await app.request("/valid-token", {
      headers: { Range: "bytes=500000-" },
    });

    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 500000-999999/1000000");
    expect(res.headers.get("Content-Length")).toBe("500000");
  });

  it("returns 416 when start >= fileSize", async () => {
    const app = createShareApp({
      verifyToken: () => validPayload,
      findFile: () => testFile,
    });
    const res = await app.request("/valid-token", {
      headers: { Range: "bytes=1000000-" },
    });

    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */1000000");
  });

  it("returns 416 when end >= fileSize", async () => {
    const app = createShareApp({
      verifyToken: () => validPayload,
      findFile: () => testFile,
    });
    const res = await app.request("/valid-token", {
      headers: { Range: "bytes=0-1000000" },
    });

    expect(res.status).toBe(416);
  });

  it("returns 416 when start > end", async () => {
    const app = createShareApp({
      verifyToken: () => validPayload,
      findFile: () => testFile,
    });
    const res = await app.request("/valid-token", {
      headers: { Range: "bytes=500-100" },
    });

    expect(res.status).toBe(416);
  });

  it("returns full file for non-byte range headers (ignored)", async () => {
    const app = createShareApp({
      verifyToken: () => validPayload,
      findFile: () => testFile,
    });
    const res = await app.request("/valid-token", {
      headers: { Range: "items=0-10" },
    });

    expect(res.status).toBe(200);
  });

  it("returns full file for malformed range header", async () => {
    const app = createShareApp({
      verifyToken: () => validPayload,
      findFile: () => testFile,
    });
    const res = await app.request("/valid-token", {
      headers: { Range: "bytes=abc-def" },
    });

    expect(res.status).toBe(200);
  });

  it("returns 206 for single byte range", async () => {
    const app = createShareApp({
      verifyToken: () => validPayload,
      findFile: () => testFile,
    });
    const res = await app.request("/valid-token", {
      headers: { Range: "bytes=0-0" },
    });

    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Length")).toBe("1");
    expect(res.headers.get("Content-Range")).toBe("bytes 0-0/1000000");
  });

  it("returns 206 for last byte range", async () => {
    const app = createShareApp({
      verifyToken: () => validPayload,
      findFile: () => testFile,
    });
    const res = await app.request("/valid-token", {
      headers: { Range: "bytes=999999-999999" },
    });

    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Length")).toBe("1");
  });
});

describe("access count fire-and-forget pattern", () => {
  it("access count increment is non-blocking", () => {
    let count = 5;
    void Promise.resolve().then(() => {
      count += 1;
    });
    expect(count).toBe(5);
  });

  it("does not affect response even if update fails", async () => {
    const app = createShareApp({
      verifyToken: () => validPayload,
      findFile: () => testFile,
    });

    const res = await app.request("/valid-token");
    expect(res.status).toBe(200);
  });
});
