import type { Database } from "@deniz-cloud/shared/db";
import { type TaskConfig, type TaskType, taskTypeEnum } from "@deniz-cloud/shared/db/schema";
import type { AuthVariables } from "@deniz-cloud/shared/middleware";
import {
  createTask,
  deleteTask,
  deleteTaskRun,
  deleteTaskRuns,
  getTask,
  listTaskRuns,
  listTasks,
  updateTask,
} from "@deniz-cloud/shared/services";
import { Cron } from "croner";
import { Hono } from "hono";
import { runTask, scheduleCronTask, unscheduleTask } from "../scheduler";

interface TaskRouteDeps {
  db: Database;
}

const VALID_TASK_TYPES = new Set<string>(taskTypeEnum.enumValues);

function parseOptionalDate(value: unknown): Date | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new Error("Date must be an ISO string");
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date");
  }

  return date;
}

function validateCronExpression(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new Error("Cron expression must be a string");
  }

  try {
    const cron = new Cron(value, { paused: true }, () => {});
    cron.stop();
  } catch {
    throw new Error("Invalid cron expression");
  }

  return value;
}

export function taskRoutes({ db }: TaskRouteDeps) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/", async (c) => {
    const page = parseInt(c.req.query("page") ?? "1", 10);
    const limit = parseInt(c.req.query("limit") ?? "50", 10);

    if (page < 1 || limit < 1 || limit > 100) {
      return c.json(
        { error: { code: "INVALID_INPUT", message: "Invalid pagination parameters" } },
        400,
      );
    }

    const result = await listTasks(db, { page, limit });

    return c.json({
      data: result.tasks,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    });
  });

  app.get("/:id", async (c) => {
    const task = await getTask(db, c.req.param("id"));
    return c.json({ data: task });
  });

  app.post("/", async (c) => {
    const body = await c.req.json();
    const user = c.get("user");

    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return c.json({ error: { code: "INVALID_INPUT", message: "Name is required" } }, 400);
    }

    if (!VALID_TASK_TYPES.has(body.type)) {
      return c.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: `Invalid task type. Must be one of: ${taskTypeEnum.enumValues.join(", ")}`,
          },
        },
        400,
      );
    }

    let cronExpression: string | undefined;
    let scheduledAt: Date | undefined;
    try {
      cronExpression = validateCronExpression(body.cronExpression);
      scheduledAt = parseOptionalDate(body.scheduledAt);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid schedule";
      return c.json({ error: { code: "INVALID_INPUT", message } }, 400);
    }

    if (!cronExpression && !scheduledAt) {
      return c.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Either cronExpression or scheduledAt is required",
          },
        },
        400,
      );
    }

    const config: TaskConfig = {
      retentionCount: body.config?.retentionCount ?? 7,
      containerNames: body.config?.containerNames,
      compress: body.config?.compress ?? true,
      databases: body.config?.databases,
      sourcePaths: body.config?.sourcePaths,
    };

    const task = await createTask(db, {
      name: body.name.trim(),
      type: body.type as TaskType,
      cronExpression,
      scheduledAt,
      config,
      createdBy: user.id,
    });

    if (task.cronExpression) {
      scheduleCronTask(db, task);
    }

    return c.json({ data: task }, 201);
  });

  app.patch("/:id", async (c) => {
    const body = await c.req.json();
    const taskId = c.req.param("id");

    let cronExpression: string | null | undefined = body.cronExpression;
    let scheduledAt: Date | null | undefined;
    try {
      cronExpression =
        body.cronExpression === null ? null : validateCronExpression(body.cronExpression);
      scheduledAt = body.scheduledAt === null ? null : parseOptionalDate(body.scheduledAt);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid schedule";
      return c.json({ error: { code: "INVALID_INPUT", message } }, 400);
    }

    const updated = await updateTask(db, taskId, {
      name: body.name,
      cronExpression,
      scheduledAt,
      nextRunAt: scheduledAt,
      config: body.config,
      enabled: body.enabled,
    });

    if (updated.enabled && updated.cronExpression) {
      scheduleCronTask(db, updated);
    } else {
      unscheduleTask(taskId);
    }

    return c.json({ data: updated });
  });

  app.delete("/:id", async (c) => {
    const taskId = c.req.param("id");
    unscheduleTask(taskId);
    await deleteTask(db, taskId);
    return c.json({ data: { success: true } });
  });

  app.post("/:id/run", async (c) => {
    const taskId = c.req.param("id");
    await getTask(db, taskId);
    runTask(db, taskId).catch((err) => {
      console.error(`[tasks] Manual run for ${taskId} failed:`, err);
    });
    return c.json({ data: { message: "Task execution started" } });
  });

  app.get("/:id/runs", async (c) => {
    const taskId = c.req.param("id");
    const page = parseInt(c.req.query("page") ?? "1", 10);
    const limit = parseInt(c.req.query("limit") ?? "20", 10);

    if (page < 1 || limit < 1 || limit > 100) {
      return c.json(
        { error: { code: "INVALID_INPUT", message: "Invalid pagination parameters" } },
        400,
      );
    }

    const result = await listTaskRuns(db, taskId, { page, limit });

    return c.json({
      data: result.runs,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    });
  });

  app.delete("/:id/runs", async (c) => {
    const taskId = c.req.param("id");
    await getTask(db, taskId);
    const deleted = await deleteTaskRuns(db, taskId);
    return c.json({ data: { deleted } });
  });

  app.delete("/:id/runs/:runId", async (c) => {
    const taskId = c.req.param("id");
    await getTask(db, taskId);
    await deleteTaskRun(db, taskId, c.req.param("runId"));
    return c.json({ data: { success: true } });
  });

  return app;
}
