import { join } from "node:path";
import type { TaskConfig, TaskRunMetadata } from "@deniz-cloud/shared/db/schema";
import { config } from "../config";
import { enforceRetention, ensureDir, exec, getFileSize, timestamp } from "./utils";

export async function executePostgresBackup(
  taskConfig: TaskConfig,
): Promise<{ output: string; metadata: TaskRunMetadata }> {
  const startTime = Date.now();
  const backupDir = join(config.backupDir, "postgres");
  await ensureDir(backupDir);

  const filename = `postgres_${timestamp()}.sql.gz`;
  const backupPath = join(backupDir, filename);

  const dumpResult = await exec([
    "docker",
    "exec",
    "-e",
    `PGPASSWORD=${config.postgresPassword}`,
    config.postgresContainer,
    "pg_dumpall",
    "-U",
    config.postgresUser,
    "--clean",
  ]);

  if (dumpResult.exitCode !== 0) {
    throw new Error(`pg_dumpall failed (exit ${dumpResult.exitCode}): ${dumpResult.stderr}`);
  }

  const gzipProc = Bun.spawn(["gzip"], {
    stdin: new Response(dumpResult.stdout).body,
    stdout: "pipe",
    stderr: "pipe",
  });

  const compressed = await new Response(gzipProc.stdout).arrayBuffer();
  const gzipExit = await gzipProc.exited;

  if (gzipExit !== 0) {
    const gzipErr = await new Response(gzipProc.stderr).text();
    throw new Error(`gzip failed (exit ${gzipExit}): ${gzipErr}`);
  }

  await Bun.write(backupPath, compressed);

  const sizeBytes = await getFileSize(backupPath);
  const retentionCount = taskConfig.retentionCount ?? 7;
  const deleted = await enforceRetention(backupDir, retentionCount);

  const durationMs = Date.now() - startTime;
  const lines = [
    `PostgreSQL backup completed: ${filename}`,
    `Size: ${(sizeBytes / 1024 / 1024).toFixed(2)} MB`,
    `Duration: ${(durationMs / 1000).toFixed(1)}s`,
  ];
  if (deleted.length > 0) {
    lines.push(`Retention cleanup: removed ${deleted.length} old backup(s)`);
  }

  return {
    output: lines.join("\n"),
    metadata: { backupPath, backupSizeBytes: sizeBytes, durationMs },
  };
}
