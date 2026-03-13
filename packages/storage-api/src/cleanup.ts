import type { Database } from "@deniz-cloud/shared/db";
import { tusUploads } from "@deniz-cloud/shared/db";
import { and, eq, lt } from "drizzle-orm";
import { deleteFile } from "./utils/fs";

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export async function cleanupExpiredUploads(db: Database): Promise<number> {
  const expired = await db
    .select({ id: tusUploads.id, tempDiskPath: tusUploads.tempDiskPath })
    .from(tusUploads)
    .where(and(eq(tusUploads.status, "in_progress"), lt(tusUploads.expiresAt, new Date())));

  for (const upload of expired) {
    await deleteFile(upload.tempDiskPath);
    await db.update(tusUploads).set({ status: "expired" }).where(eq(tusUploads.id, upload.id));
  }

  return expired.length;
}

export function startCleanupScheduler(db: Database): ReturnType<typeof setInterval> {
  const run = async () => {
    try {
      const count = await cleanupExpiredUploads(db);
      if (count > 0) {
        console.log(`Cleaned up ${count} expired upload(s)`);
      }
    } catch (err) {
      console.error("Upload cleanup failed:", err);
    }
  };

  void run();

  return setInterval(run, CLEANUP_INTERVAL_MS);
}
