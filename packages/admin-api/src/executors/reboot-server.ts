import type { TaskConfig, TaskRunMetadata } from "@deniz-cloud/shared/db/schema";
import { exec } from "./utils";

export async function executeRebootServer(
  _taskConfig: TaskConfig,
): Promise<{ output: string; metadata: TaskRunMetadata }> {
  const startTime = Date.now();

  const result = await exec([
    "docker",
    "run",
    "--rm",
    "--privileged",
    "--pid=host",
    "alpine",
    "nsenter",
    "-t",
    "1",
    "-m",
    "-u",
    "-i",
    "-n",
    "--",
    "reboot",
  ]);

  const durationMs = Date.now() - startTime;

  if (result.exitCode !== 0 && !result.stderr.includes("Connection reset")) {
    throw new Error(`Reboot command failed (exit ${result.exitCode}): ${result.stderr}`);
  }

  return {
    output: `Server reboot initiated.\n${result.stdout}${result.stderr}`.trim(),
    metadata: { durationMs },
  };
}
