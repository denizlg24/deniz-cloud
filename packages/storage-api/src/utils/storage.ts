import { type Folder, folders } from "@deniz-cloud/shared/db";
import type { SQL } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { ensureDir } from "./fs";
import { buildUserRootPath, resolveSsdDiskPath, SHARED_ROOT_PATH } from "./path";

interface StorageConfig {
  ssdStoragePath: string;
  hddStoragePath: string;
  tempUploadPath: string;
}

export interface StorageDb {
  query: {
    folders: {
      findFirst(config?: { where?: SQL }): Promise<Folder | undefined>;
    };
  };
  insert(table: typeof folders): {
    values(data: typeof folders.$inferInsert): {
      onConflictDoNothing(): {
        returning(): Promise<Folder[]>;
      };
    };
  };
}

export async function initStorageDirs(config: StorageConfig): Promise<void> {
  await Promise.all([
    ensureDir(config.ssdStoragePath),
    ensureDir(config.hddStoragePath),
    ensureDir(config.tempUploadPath),
  ]);
}

export async function ensureSharedFolder(db: StorageDb, config: StorageConfig): Promise<Folder> {
  const existing = await db.query.folders.findFirst({
    where: eq(folders.path, SHARED_ROOT_PATH),
  });
  if (existing) return existing;

  const diskPath = resolveSsdDiskPath(config.ssdStoragePath, SHARED_ROOT_PATH);
  await ensureDir(diskPath);

  const [folder] = await db
    .insert(folders)
    .values({
      path: SHARED_ROOT_PATH,
      name: "shared",
      ownerId: null,
    })
    .onConflictDoNothing()
    .returning();

  if (!folder) {
    const refetched = await db.query.folders.findFirst({
      where: eq(folders.path, SHARED_ROOT_PATH),
    });
    if (!refetched) throw new Error("Failed to create or find shared folder");
    return refetched;
  }

  return folder;
}

export async function initUserStorage(
  db: StorageDb,
  config: StorageConfig,
  userId: string,
): Promise<Folder> {
  const rootPath = buildUserRootPath(userId);

  const existing = await db.query.folders.findFirst({
    where: eq(folders.path, rootPath),
  });
  if (existing) return existing;

  const diskPath = resolveSsdDiskPath(config.ssdStoragePath, rootPath);
  await ensureDir(diskPath);

  const [folder] = await db
    .insert(folders)
    .values({
      path: rootPath,
      name: userId,
      ownerId: userId,
    })
    .onConflictDoNothing()
    .returning();

  if (!folder) {
    const refetched = await db.query.folders.findFirst({
      where: eq(folders.path, rootPath),
    });
    if (!refetched) throw new Error(`Failed to create or find user root folder: ${rootPath}`);
    return refetched;
  }

  return folder;
}
