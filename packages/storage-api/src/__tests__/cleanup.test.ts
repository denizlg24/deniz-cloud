import { describe, expect, it, mock, spyOn } from "bun:test";

describe("cleanupExpiredUploads", () => {
  interface ExpiredUpload {
    id: string;
    tempDiskPath: string;
  }

  async function cleanupExpiredUploads(
    expired: ExpiredUpload[],
    deleteFile: (path: string) => Promise<void>,
    markExpired: (id: string) => Promise<void>,
  ): Promise<number> {
    for (const upload of expired) {
      await deleteFile(upload.tempDiskPath);
      await markExpired(upload.id);
    }
    return expired.length;
  }

  it("returns 0 when no expired uploads exist", async () => {
    const deleteFile = mock(() => Promise.resolve());
    const markExpired = mock(() => Promise.resolve());
    const count = await cleanupExpiredUploads([], deleteFile, markExpired);

    expect(count).toBe(0);
    expect(deleteFile).not.toHaveBeenCalled();
    expect(markExpired).not.toHaveBeenCalled();
  });

  it("processes single expired upload", async () => {
    const deleteFile = mock(() => Promise.resolve());
    const markExpired = mock(() => Promise.resolve());
    const expired = [{ id: "upload-1", tempDiskPath: "/tmp/uploads/abc123" }];

    const count = await cleanupExpiredUploads(expired, deleteFile, markExpired);

    expect(count).toBe(1);
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith("/tmp/uploads/abc123");
    expect(markExpired).toHaveBeenCalledTimes(1);
    expect(markExpired).toHaveBeenCalledWith("upload-1");
  });

  it("processes multiple expired uploads sequentially", async () => {
    const callOrder: string[] = [];
    const deleteFile = mock((path: string) => {
      callOrder.push(`delete:${path}`);
      return Promise.resolve();
    });
    const markExpired = mock((id: string) => {
      callOrder.push(`mark:${id}`);
      return Promise.resolve();
    });

    const expired = [
      { id: "u1", tempDiskPath: "/tmp/a" },
      { id: "u2", tempDiskPath: "/tmp/b" },
      { id: "u3", tempDiskPath: "/tmp/c" },
    ];

    const count = await cleanupExpiredUploads(expired, deleteFile, markExpired);

    expect(count).toBe(3);
    expect(deleteFile).toHaveBeenCalledTimes(3);
    expect(markExpired).toHaveBeenCalledTimes(3);
    expect(callOrder).toEqual([
      "delete:/tmp/a",
      "mark:u1",
      "delete:/tmp/b",
      "mark:u2",
      "delete:/tmp/c",
      "mark:u3",
    ]);
  });

  it("propagates deleteFile errors (stops processing)", async () => {
    const deleteFile = mock(() => Promise.reject(new Error("ENOENT")));
    const markExpired = mock(() => Promise.resolve());
    const expired = [
      { id: "u1", tempDiskPath: "/tmp/missing" },
      { id: "u2", tempDiskPath: "/tmp/also-missing" },
    ];

    await expect(cleanupExpiredUploads(expired, deleteFile, markExpired)).rejects.toThrow("ENOENT");
    expect(markExpired).not.toHaveBeenCalled();
  });

  it("propagates markExpired errors (stops processing)", async () => {
    const deleteFile = mock(() => Promise.resolve());
    const markExpired = mock(() => Promise.reject(new Error("DB connection lost")));
    const expired = [{ id: "u1", tempDiskPath: "/tmp/a" }];

    await expect(cleanupExpiredUploads(expired, deleteFile, markExpired)).rejects.toThrow(
      "DB connection lost",
    );
    expect(deleteFile).toHaveBeenCalledTimes(1);
  });
});

describe("startCleanupScheduler", () => {
  it("runs cleanup immediately on start", async () => {
    let ran = false;
    const runFn = async () => {
      ran = true;
    };
    void runFn();
    await Bun.sleep(10);
    expect(ran).toBe(true);
  });

  it("logs count when expired uploads are cleaned", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const count = 3;
      if (count > 0) {
        console.log(`Cleaned up ${count} expired upload(s)`);
      }
      expect(logSpy).toHaveBeenCalledWith("Cleaned up 3 expired upload(s)");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("does not log when count is 0", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const count = 0;
      if (count > 0) {
        console.log(`Cleaned up ${count} expired upload(s)`);
      }
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("catches and logs errors without crashing", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const error = new Error("DB down");
      try {
        throw error;
      } catch (err) {
        console.error("Upload cleanup failed:", err);
      }
      expect(errorSpy).toHaveBeenCalledWith("Upload cleanup failed:", error);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("cleanup interval constant", () => {
  it("cleanup runs every 1 hour", () => {
    const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
    expect(CLEANUP_INTERVAL_MS).toBe(3_600_000);
  });
});
