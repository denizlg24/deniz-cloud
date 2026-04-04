import { desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db";
import {
  scheduledTasks,
  type TaskConfig,
  type TaskRunMetadata,
  type TaskType,
  taskRuns,
} from "../db/schema";
import type { SafeScheduledTask, SafeTaskRun } from "../types";
import { AuthError } from "./auth";

export async function createTask(
  db: Database,
  input: {
    name: string;
    type: TaskType;
    cronExpression?: string;
    scheduledAt?: Date;
    config?: TaskConfig;
    createdBy: string;
  },
): Promise<SafeScheduledTask> {
  const [task] = await db
    .insert(scheduledTasks)
    .values({
      name: input.name,
      type: input.type,
      cronExpression: input.cronExpression,
      scheduledAt: input.scheduledAt,
      config: input.config ?? {},
      createdBy: input.createdBy,
    })
    .returning();

  if (!task) throw new Error("Failed to create scheduled task");
  return task;
}

export async function listTasks(
  db: Database,
  opts: { page?: number; limit?: number } = {},
): Promise<{ tasks: SafeScheduledTask[]; total: number }> {
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 50;
  const offset = (page - 1) * limit;

  const [allTasks, countResult] = await Promise.all([
    db
      .select()
      .from(scheduledTasks)
      .orderBy(desc(scheduledTasks.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(scheduledTasks),
  ]);

  return {
    tasks: allTasks,
    total: countResult[0]?.count ?? 0,
  };
}

export async function getTask(db: Database, taskId: string): Promise<SafeScheduledTask> {
  const task = await db.query.scheduledTasks.findFirst({
    where: eq(scheduledTasks.id, taskId),
  });

  if (!task) throw new AuthError("Task not found", "TASK_NOT_FOUND", 404);
  return task;
}

export async function updateTask(
  db: Database,
  taskId: string,
  input: {
    name?: string;
    cronExpression?: string | null;
    scheduledAt?: Date | null;
    nextRunAt?: Date | null;
    config?: TaskConfig;
    enabled?: boolean;
  },
): Promise<SafeScheduledTask> {
  const existing = await db.query.scheduledTasks.findFirst({
    where: eq(scheduledTasks.id, taskId),
  });
  if (!existing) throw new AuthError("Task not found", "TASK_NOT_FOUND", 404);

  const [updated] = await db
    .update(scheduledTasks)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(scheduledTasks.id, taskId))
    .returning();

  if (!updated) throw new Error("Failed to update task");
  return updated;
}

export async function deleteTask(db: Database, taskId: string): Promise<void> {
  const task = await db.query.scheduledTasks.findFirst({
    where: eq(scheduledTasks.id, taskId),
  });
  if (!task) throw new AuthError("Task not found", "TASK_NOT_FOUND", 404);

  await db.delete(scheduledTasks).where(eq(scheduledTasks.id, taskId));
}

export async function createTaskRun(
  db: Database,
  input: {
    taskId: string;
    status?: "pending" | "running";
  },
): Promise<SafeTaskRun> {
  const [run] = await db
    .insert(taskRuns)
    .values({
      taskId: input.taskId,
      status: input.status ?? "pending",
      startedAt: input.status === "running" ? new Date() : undefined,
    })
    .returning();

  if (!run) throw new Error("Failed to create task run");
  return run;
}

export async function updateTaskRun(
  db: Database,
  runId: string,
  input: {
    status?: "running" | "completed" | "failed";
    output?: string;
    error?: string;
    metadata?: TaskRunMetadata;
  },
): Promise<SafeTaskRun> {
  const updates: Record<string, unknown> = { ...input };
  if (input.status === "running") {
    updates.startedAt = new Date();
  }
  if (input.status === "completed" || input.status === "failed") {
    updates.completedAt = new Date();
  }

  const [updated] = await db
    .update(taskRuns)
    .set(updates)
    .where(eq(taskRuns.id, runId))
    .returning();

  if (!updated) throw new Error("Failed to update task run");
  return updated;
}

export async function listTaskRuns(
  db: Database,
  taskId: string,
  opts: { page?: number; limit?: number } = {},
): Promise<{ runs: SafeTaskRun[]; total: number }> {
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;
  const offset = (page - 1) * limit;

  const [allRuns, countResult] = await Promise.all([
    db
      .select()
      .from(taskRuns)
      .where(eq(taskRuns.taskId, taskId))
      .orderBy(desc(taskRuns.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(taskRuns)
      .where(eq(taskRuns.taskId, taskId)),
  ]);

  return {
    runs: allRuns,
    total: countResult[0]?.count ?? 0,
  };
}

export async function getLatestTaskRuns(db: Database): Promise<SafeTaskRun[]> {
  const latestRuns = await db.execute(sql`
    SELECT DISTINCT ON (task_id) *
    FROM task_runs
    ORDER BY task_id, created_at DESC
  `);

  return [...latestRuns] as SafeTaskRun[];
}
