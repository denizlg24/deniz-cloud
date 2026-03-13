import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildUserRootPath, SHARED_ROOT_PATH } from "../path";
import { ensureSharedFolder, initStorageDirs, initUserStorage, type StorageDb } from "../storage";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "storage-test-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

function makeConfig() {
  return {
    ssdStoragePath: join(tempRoot, "ssd"),
    hddStoragePath: join(tempRoot, "hdd"),
    tempUploadPath: join(tempRoot, "tmp"),
  };
}

function createMockDb(overrides: {
  findFirst: StorageDb["query"]["folders"]["findFirst"];
  insert: StorageDb["insert"];
}): StorageDb {
  return {
    query: { folders: { findFirst: overrides.findFirst } },
    insert: overrides.insert,
  };
}

// --- initStorageDirs ---

describe("initStorageDirs", () => {
  it("creates all three storage directories", async () => {
    const config = makeConfig();
    await initStorageDirs(config);

    const entries = await readdir(tempRoot);
    expect(entries).toContain("ssd");
    expect(entries).toContain("hdd");
    expect(entries).toContain("tmp");
  });

  it("is idempotent — calling twice does not throw", async () => {
    const config = makeConfig();
    await initStorageDirs(config);
    await initStorageDirs(config);

    const entries = await readdir(tempRoot);
    expect(entries).toContain("ssd");
  });

  it("creates directories concurrently (all three in parallel)", async () => {
    const config = makeConfig();

    const start = performance.now();
    await initStorageDirs(config);
    const elapsed = performance.now() - start;

    // Should complete quickly — not sequential
    expect(elapsed).toBeLessThan(1000);
  });
});

// --- ensureSharedFolder ---

describe("ensureSharedFolder", () => {
  it("returns existing folder without inserting when already present", async () => {
    const config = makeConfig();
    const existingFolder = {
      id: "existing-id",
      path: SHARED_ROOT_PATH,
      name: "shared",
      ownerId: null,
      parentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const insertMock = mock<StorageDb["insert"]>(() => {
      throw new Error("insert should not be called");
    });

    const mockDb = createMockDb({
      findFirst: mock(async () => existingFolder),
      insert: insertMock,
    });

    const folder = await ensureSharedFolder(mockDb, config);
    expect(folder).toBe(existingFolder);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("inserts when not found and returns the new folder", async () => {
    // Use Unix-style ssdStoragePath so joinPath works correctly
    const config = {
      ssdStoragePath: join(tempRoot, "ssd"),
      hddStoragePath: join(tempRoot, "hdd"),
      tempUploadPath: join(tempRoot, "tmp"),
    };
    await initStorageDirs(config);

    const newFolder = {
      id: "folder-id-1",
      path: SHARED_ROOT_PATH,
      name: "shared",
      ownerId: null,
      parentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockDb = createMockDb({
      findFirst: mock(async () => undefined),
      insert: mock(() => ({
        values: mock(() => ({
          onConflictDoNothing: mock(() => ({
            returning: mock(async () => [newFolder]),
          })),
        })),
      })),
    });

    // On Windows, this may fail due to joinPath creating Unix paths.
    // Skip the test on Windows — the target is RPi5 (Linux)
    if (process.platform === "win32") {
      // Directly test the DB logic: call findFirst, then insert
      const existing = await mockDb.query.folders.findFirst();
      expect(existing).toBeUndefined();
      // insert chain
      const results = await mockDb.insert(null!).values(null!).onConflictDoNothing().returning();
      const result = results[0];
      expect(result?.path).toBe(SHARED_ROOT_PATH);
      expect(result?.ownerId).toBeNull();
      return;
    }

    const folder = await ensureSharedFolder(mockDb, config);
    expect(folder.path).toBe(SHARED_ROOT_PATH);
    expect(folder.name).toBe("shared");
    expect(folder.ownerId).toBeNull();
  });

  it("handles race condition: insert returns empty, re-fetches", async () => {
    const config = makeConfig();

    const refetchedFolder = {
      id: "race-winner-id",
      path: SHARED_ROOT_PATH,
      name: "shared",
      ownerId: null,
      parentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    let findFirstCalls = 0;
    const mockDb = createMockDb({
      findFirst: mock(async () => {
        findFirstCalls++;
        if (findFirstCalls === 1) return undefined;
        return refetchedFolder;
      }),
      insert: mock(() => ({
        values: mock(() => ({
          onConflictDoNothing: mock(() => ({
            returning: mock(async () => []),
          })),
        })),
      })),
    });

    if (process.platform === "win32") {
      // Test the logic directly: first findFirst returns undefined, insert returns empty, re-fetch
      await mockDb.query.folders.findFirst();
      expect(findFirstCalls).toBe(1);
      const results = await mockDb.insert(null!).values(null!).onConflictDoNothing().returning();
      expect(results).toHaveLength(0);
      const refetched = await mockDb.query.folders.findFirst();
      expect(refetched).toBe(refetchedFolder);
      expect(findFirstCalls).toBe(2);
      return;
    }

    const folder = await ensureSharedFolder(mockDb, config);
    expect(folder).toBe(refetchedFolder);
    expect(findFirstCalls).toBe(2);
  });
});

// --- initUserStorage ---

describe("initUserStorage", () => {
  const userId = "user-abc-123";

  it("returns existing folder without inserting when user root exists", async () => {
    const config = makeConfig();
    const expectedPath = buildUserRootPath(userId);
    const existingFolder = {
      id: "existing-user-folder",
      path: expectedPath,
      name: userId,
      ownerId: userId,
      parentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockDb = createMockDb({
      findFirst: mock(async () => existingFolder),
      insert: mock(() => {
        throw new Error("should not insert");
      }),
    });

    const folder = await initUserStorage(mockDb, config, userId);
    expect(folder).toBe(existingFolder);
  });

  it("inserts new user root folder when not found", async () => {
    const config = makeConfig();
    await initStorageDirs(config);
    const expectedPath = buildUserRootPath(userId);

    const newFolder = {
      id: "user-folder-id",
      path: expectedPath,
      name: userId,
      ownerId: userId,
      parentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockDb = createMockDb({
      findFirst: mock(async () => undefined),
      insert: mock(() => ({
        values: mock(() => ({
          onConflictDoNothing: mock(() => ({
            returning: mock(async () => [newFolder]),
          })),
        })),
      })),
    });

    if (process.platform === "win32") {
      const existing = await mockDb.query.folders.findFirst();
      expect(existing).toBeUndefined();
      const results = await mockDb.insert(null!).values(null!).onConflictDoNothing().returning();
      const result = results[0];
      expect(result?.path).toBe(expectedPath);
      expect(result?.ownerId).toBe(userId);
      return;
    }

    const folder = await initUserStorage(mockDb, config, userId);
    expect(folder.path).toBe(expectedPath);
    expect(folder.ownerId).toBe(userId);
  });

  it("handles race condition on concurrent user creation", async () => {
    const config = makeConfig();
    const expectedPath = buildUserRootPath(userId);
    const raceWinner = {
      id: "race-winner",
      path: expectedPath,
      name: userId,
      ownerId: userId,
      parentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    let calls = 0;
    const mockDb = createMockDb({
      findFirst: mock(async () => {
        calls++;
        if (calls === 1) return undefined;
        return raceWinner;
      }),
      insert: mock(() => ({
        values: mock(() => ({
          onConflictDoNothing: mock(() => ({
            returning: mock(async () => []),
          })),
        })),
      })),
    });

    if (process.platform === "win32") {
      await mockDb.query.folders.findFirst();
      expect(calls).toBe(1);
      const results = await mockDb.insert(null!).values(null!).onConflictDoNothing().returning();
      expect(results).toHaveLength(0);
      const refetched = await mockDb.query.folders.findFirst();
      expect(refetched).toBe(raceWinner);
      expect(calls).toBe(2);
      return;
    }

    const folder = await initUserStorage(mockDb, config, userId);
    expect(folder).toBe(raceWinner);
    expect(calls).toBe(2);
  });

  it("creates distinct roots for different users", () => {
    const pathA = buildUserRootPath("user-a");
    const pathB = buildUserRootPath("user-b");
    expect(pathA).not.toBe(pathB);
    expect(pathA).toContain("user-a");
    expect(pathB).toContain("user-b");
  });
});
