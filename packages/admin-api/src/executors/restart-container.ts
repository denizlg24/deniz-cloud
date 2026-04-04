import type { TaskConfig, TaskRunMetadata } from "@deniz-cloud/shared/db/schema";
import { exec } from "./utils";

export async function executeRestartContainer(
  taskConfig: TaskConfig,
): Promise<{ output: string; metadata: TaskRunMetadata }> {
  const startTime = Date.now();
  const containerNames = taskConfig.containerNames ?? [];

  if (containerNames.length === 0) {
    throw new Error("No container names specified in task config");
  }

  const lines: string[] = [];

  for (const name of containerNames) {
    const result = await exec(["docker", "restart", name]);

    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to restart container ${name} (exit ${result.exitCode}): ${result.stderr}`,
      );
    }

    lines.push(`Restarted container: ${name}`);
  }

  const durationMs = Date.now() - startTime;
  lines.push(`Duration: ${(durationMs / 1000).toFixed(1)}s`);

  return {
    output: lines.join("\n"),
    metadata: { durationMs },
  };
}
