import type { Database } from "@deniz-cloud/shared/db";
import type { ScheduledTask } from "@deniz-cloud/shared/db/schema";
import { scheduledTasks } from "@deniz-cloud/shared/db/schema";
import {
  createTaskRun,
  getTask,
  markInterruptedTaskRuns,
  updateTask,
  updateTaskRun,
} from "@deniz-cloud/shared/services";
import { Cron } from "croner";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { getExecutor } from "./executors";

const activeCrons = new Map<string, Cron>();
const activeRuns = new Set<string>();
let oneOffTimer: ReturnType<typeof setInterval> | null = null;

export async function startScheduler(db: Database): Promise<void> {
  const interruptedCount = await markInterruptedTaskRuns(db);
  if (interruptedCount > 0) {
    console.warn(`[scheduler] Marked ${interruptedCount} interrupted task run(s) as failed`);
  }

  const allTasks = await db.select().from(scheduledTasks).where(eq(scheduledTasks.enabled, true));

  for (const task of allTasks) {
    if (task.cronExpression) {
      scheduleCronTask(db, task);
    }
  }

  await pollOneOffTasks(db);
  oneOffTimer = setInterval(() => {
    pollOneOffTasks(db).catch((err) => {
      console.error("[scheduler] Failed to poll one-off tasks:", err);
    });
  }, 30_000);

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
  if (activeRuns.has(taskId)) {
    console.warn(`[scheduler] Task ${taskId} is already running; skipping duplicate execution`);
    return;
  }

  activeRuns.add(taskId);
  let taskName = taskId;
  let runId: string | null = null;
  try {
    const task = await getTask(db, taskId);
    taskName = task.name;
    const executor = getExecutor(task.type);

    const run = await createTaskRun(db, { taskId, status: "running" });
    runId = run.id;

    const result = await executor(task.config);

    await updateTaskRun(db, run.id, {
      status: "completed",
      output: result.output,
      metadata: result.metadata,
    });

    try {
      if (task.cronExpression) {
        const cron = activeCrons.get(taskId);
        const nextRun = cron?.nextRun();
        if (nextRun) {
          await updateTask(db, taskId, { nextRunAt: nextRun });
        }
      } else {
        await updateTask(db, taskId, { nextRunAt: null, enabled: false });
      }
    } catch (err) {
      console.error(`[scheduler] Failed to update schedule metadata for task ${taskId}:`, err);
    }

    console.log(`[scheduler] Task "${task.name}" completed successfully`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (runId) {
      await updateTaskRun(db, runId, {
        status: "failed",
        error: message,
      }).catch((updateErr) => {
        console.error(`[scheduler] Failed to update failed run for task ${taskId}:`, updateErr);
      });
    }
    console.error(`[scheduler] Task "${taskName}" failed:`, message);
  } finally {
    activeRuns.delete(taskId);
  }
}
