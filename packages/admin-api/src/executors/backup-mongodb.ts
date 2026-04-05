import { join } from "node:path";
import type { TaskConfig, TaskRunMetadata } from "@deniz-cloud/shared/db/schema";
import { config } from "../config";
import { enforceRetention, ensureDir, exec, getFileSize, timestamp } from "./utils";

export async function executeMongoBackup(
  taskConfig: TaskConfig,
): Promise<{ output: string; metadata: TaskRunMetadata }> {
  const startTime = Date.now();
  const backupDir = join(config.backupDir, "mongodb");
  await ensureDir(backupDir);

  const filename = `mongodb_${timestamp()}.archive.gz`;
  const backupPath = join(backupDir, filename);
  const containerBackupPath = `/tmp/${filename}`;

  const mongoUser = config.mongoUser;
  const mongoPass = config.mongoPassword;

  const dumpArgs = [
    "docker",
    "exec",
    config.mongodbContainer,
    "mongodump",
    `--uri=mongodb://${mongoUser}:${mongoPass}@localhost:27017/?authSource=admin&directConnection=true`,
    `--archive=${containerBackupPath}`,
    "--gzip",
  ];

  if (taskConfig.databases && taskConfig.databases.length > 0) {
    for (const db of taskConfig.databases) {
      dumpArgs.push(`--db=${db}`);
    }
  }

  const dumpResult = await exec(dumpArgs);

  if (dumpResult.exitCode !== 0) {
    throw new Error(`mongodump failed (exit ${dumpResult.exitCode}): ${dumpResult.stderr}`);
  }

  const copyResult = await exec([
    "docker",
    "cp",
    `${config.mongodbContainer}:${containerBackupPath}`,
    backupPath,
  ]);

  if (copyResult.exitCode !== 0) {
    throw new Error(`docker cp failed (exit ${copyResult.exitCode}): ${copyResult.stderr}`);
  }

  await exec(["docker", "exec", config.mongodbContainer, "rm", "-f", containerBackupPath]);

  const sizeBytes = await getFileSize(backupPath);
  const retentionCount = taskConfig.retentionCount ?? 7;
  const deleted = await enforceRetention(backupDir, retentionCount);

  const durationMs = Date.now() - startTime;
  const lines = [
    `MongoDB backup completed: ${filename}`,
    `Size: ${(sizeBytes / 1024 / 1024).toFixed(2)} MB`,
    `Duration: ${(durationMs / 1000).toFixed(1)}s`,
  ];
  if (taskConfig.databases?.length) {
    lines.push(`Databases: ${taskConfig.databases.join(", ")}`);
  }
  if (deleted.length > 0) {
    lines.push(`Retention cleanup: removed ${deleted.length} old backup(s)`);
  }

  return {
    output: lines.join("\n"),
    metadata: { backupPath, backupSizeBytes: sizeBytes, durationMs },
  };
}
