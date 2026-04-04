import type { Database } from "@deniz-cloud/shared/db";
import type { ScheduledTask } from "@deniz-cloud/shared/db/schema";
import { scheduledTasks } from "@deniz-cloud/shared/db/schema";
import { createTaskRun, getTask, updateTask, updateTaskRun } from "@deniz-cloud/shared/services";
import { Cron } from "croner";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { getExecutor } from "./executors";

const activeCrons = new Map<string, Cron>();
let oneOffTimer: ReturnType<typeof setInterval> | null = null;

export async function startScheduler(db: Database): Promise<void> {
  const allTasks = await db.select().from(scheduledTasks).where(eq(scheduledTasks.enabled, true));

  for (const task of allTasks) {
    if (task.cronExpression) {
      scheduleCronTask(db, task);
    }
  }

  oneOffTimer = setInterval(() => pollOneOffTasks(db), 30_000);

  console.log(
    `[scheduler] Started with ${allTasks.filter((t) => t.cronExpression).length} cron task(s)`,
  );
}

export function stopScheduler(): void {
  for (const [id, cron] of activeCrons) {
    cron.stop();
    activeCrons.delete(id);
  }
  if (oneOffTimer) {
    clearInterval(oneOffTimer);
    oneOffTimer = null;
  }
  console.log("[scheduler] Stopped");
}

export function scheduleCronTask(db: Database, task: ScheduledTask): void {
  const existing = activeCrons.get(task.id);
  if (existing) {
    existing.stop();
    activeCrons.delete(task.id);
  }

  if (!task.cronExpression || !task.enabled) return;

  const cron = new Cron(task.cronExpression, async () => {
    await runTask(db, task.id);
  });

  const nextRun = cron.nextRun();
  if (nextRun) {
    updateTask(db, task.id, { nextRunAt: nextRun }).catch((err) => {
      console.error(`[scheduler] Failed to update nextRunAt for task ${task.id}:`, err);
    });
  }

  activeCrons.set(task.id, cron);
  console.log(
    `[scheduler] Scheduled cron task "${task.name}" (${task.cronExpression}), next: ${nextRun?.toISOString()}`,
  );
}

export function unscheduleTask(taskId: string): void {
  const existing = activeCrons.get(taskId);
  if (existing) {
    existing.stop();
    activeCrons.delete(taskId);
    console.log(`[scheduler] Unscheduled task ${taskId}`);
  }
}

async function pollOneOffTasks(db: Database): Promise<void> {
  const now = new Date();
  const dueTasks = await db
    .select()
    .from(scheduledTasks)
    .where(
      and(
        eq(scheduledTasks.enabled, true),
        isNotNull(scheduledTasks.scheduledAt),
        lte(scheduledTasks.scheduledAt, now),
      ),
    );

  for (const task of dueTasks) {
    await updateTask(db, task.id, { enabled: false });
    runTask(db, task.id).catch((err) => {
      console.error(`[scheduler] One-off task ${task.id} failed:`, err);
    });
  }
}

export async function runTask(db: Database, taskId: string): Promise<void> {
  const task = await getTask(db, taskId);
  const executor = getExecutor(task.type);

  const run = await createTaskRun(db, { taskId, status: "running" });

  try {
    const result = await executor(task.config);

    await updateTaskRun(db, run.id, {
      status: "completed",
      output: result.output,
      metadata: result.metadata,
    });

    if (task.cronExpression) {
      const cron = activeCrons.get(taskId);
      const nextRun = cron?.nextRun();
      if (nextRun) {
        await updateTask(db, taskId, { nextRunAt: nextRun });
      }
    }

    console.log(`[scheduler] Task "${task.name}" completed successfully`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateTaskRun(db, run.id, {
      status: "failed",
      error: message,
    });
    console.error(`[scheduler] Task "${task.name}" failed:`, message);
  }
}
