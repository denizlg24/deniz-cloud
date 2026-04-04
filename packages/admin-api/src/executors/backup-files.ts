import { join } from "node:path";
import type { TaskConfig, TaskRunMetadata } from "@deniz-cloud/shared/db/schema";
import { config } from "../config";
import { enforceRetention, ensureDir, exec, getDirSize, timestamp } from "./utils";

const DEFAULT_SOURCE_PATHS = ["/data/ssd", "/data/hdd"];

export async function executeFilesBackup(
  taskConfig: TaskConfig,
): Promise<{ output: string; metadata: TaskRunMetadata }> {
  const startTime = Date.now();
  const ts = timestamp();
  const backupDir = join(config.backupDir, "files", ts);
  await ensureDir(backupDir);

  const sourcePaths = taskConfig.sourcePaths ?? DEFAULT_SOURCE_PATHS;
  const lines: string[] = [];
  let totalFiles = 0;

  for (const src of sourcePaths) {
    const destName = src.replace(/\//g, "_").replace(/^_/, "");
    const dest = join(backupDir, destName);
    await ensureDir(dest);

    const result = await exec(["rsync", "-a", "--delete", "--stats", `${src}/`, `${dest}/`]);

    if (result.exitCode !== 0) {
      throw new Error(`rsync failed for ${src} (exit ${result.exitCode}): ${result.stderr}`);
    }

    const filesMatch = result.stdout.match(/Number of regular files transferred:\s*([\d,]+)/);
    const count = filesMatch?.[1] ? parseInt(filesMatch[1].replace(/,/g, ""), 10) : 0;
    totalFiles += count;
    lines.push(`Synced ${src} → ${dest} (${count} files transferred)`);
  }

  const sizeBytes = await getDirSize(backupDir);
  const retentionCount = taskConfig.retentionCount ?? 7;
  const parentDir = join(config.backupDir, "files");
  const deleted = await enforceRetention(parentDir, retentionCount);

  const durationMs = Date.now() - startTime;
  lines.unshift(`File backup completed: ${ts}`);
  lines.push(`Total size: ${(sizeBytes / 1024 / 1024).toFixed(2)} MB`);
  lines.push(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
  if (deleted.length > 0) {
    lines.push(`Retention cleanup: removed ${deleted.length} old backup(s)`);
  }

  return {
    output: lines.join("\n"),
    metadata: {
      backupPath: backupDir,
      backupSizeBytes: sizeBytes,
      durationMs,
      filesBackedUp: totalFiles,
    },
  };
}
