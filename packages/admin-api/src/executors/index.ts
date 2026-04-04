import type { TaskConfig, TaskRunMetadata, TaskType } from "@deniz-cloud/shared/db/schema";
import { executeFilesBackup } from "./backup-files";
import { executeMongoBackup } from "./backup-mongodb";
import { executePostgresBackup } from "./backup-postgres";
import { executeRebootServer } from "./reboot-server";
import { executeRestartContainer } from "./restart-container";

type ExecutorResult = { output: string; metadata: TaskRunMetadata };
type Executor = (config: TaskConfig) => Promise<ExecutorResult>;

const executors: Record<TaskType, Executor> = {
  backup_postgres: executePostgresBackup,
  backup_mongodb: executeMongoBackup,
  backup_files: executeFilesBackup,
  backup_all: async (config) => {
    const results: string[] = [];
    let totalDuration = 0;

    const pgResult = await executePostgresBackup(config);
    results.push(pgResult.output);
    totalDuration += pgResult.metadata.durationMs ?? 0;

    const mongoResult = await executeMongoBackup(config);
    results.push(mongoResult.output);
    totalDuration += mongoResult.metadata.durationMs ?? 0;

    const filesResult = await executeFilesBackup(config);
    results.push(filesResult.output);
    totalDuration += filesResult.metadata.durationMs ?? 0;

    return {
      output: results.join("\n---\n"),
      metadata: { durationMs: totalDuration },
    };
  },
  restart_container: executeRestartContainer,
  reboot_server: executeRebootServer,
};

export function getExecutor(type: TaskType): Executor {
  return executors[type];
}
