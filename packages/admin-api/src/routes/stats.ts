import { readFile } from "node:fs/promises";
import { cpus, freemem, totalmem } from "node:os";
import type { Database } from "@deniz-cloud/shared/db";
import { files, folders, sessions, users } from "@deniz-cloud/shared/db/schema";
import type { AuthVariables } from "@deniz-cloud/shared/middleware";
import { count, eq, gt, sum } from "drizzle-orm";
import { Hono } from "hono";

interface StatsRouteDeps {
  db: Database;
}

async function readProcFile(path: string): Promise<string> {
  const hostPath = `/host/proc/${path}`;
  const localPath = `/proc/${path}`;

  try {
    return await readFile(hostPath, "utf-8");
  } catch {
    return await readFile(localPath, "utf-8");
  }
}

async function getCpuUsage(): Promise<{ usagePercent: number; cores: number }> {
  try {
    const stat = await readProcFile("stat");
    const cpuLine = stat.split("\n").find((l) => l.startsWith("cpu "));
    if (!cpuLine) throw new Error("No cpu line");

    const parts = cpuLine.split(/\s+/).slice(1).map(Number);
    const idle = parts[3] ?? 0;
    const total = parts.reduce((a, b) => a + b, 0);

    const cpuInfoLines = stat.split("\n").filter((l) => /^cpu\d+/.test(l));
    const cores = cpuInfoLines.length;

    const usagePercent = total > 0 ? Math.round(((total - idle) / total) * 100 * 10) / 10 : 0;
    return { usagePercent, cores };
  } catch {
    const cpuInfo = cpus();
    if (cpuInfo.length === 0) return { usagePercent: 0, cores: 0 };

    let totalIdle = 0;
    let totalTick = 0;
    for (const cpu of cpuInfo) {
      totalIdle += cpu.times.idle;
      totalTick += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
    }

    const usagePercent =
      totalTick > 0 ? Math.round(((totalTick - totalIdle) / totalTick) * 100 * 10) / 10 : 0;
    return { usagePercent, cores: cpuInfo.length };
  }
}

async function getMemoryUsage(): Promise<{
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
}> {
  try {
    const meminfo = await readProcFile("meminfo");
    const lines = meminfo.split("\n");

    function extractKb(key: string): number {
      const line = lines.find((l) => l.startsWith(key));
      if (!line) return 0;
      const match = line.match(/(\d+)/);
      return match?.[1] ? parseInt(match[1], 10) * 1024 : 0;
    }

    const totalBytes = extractKb("MemTotal:");
    const availableBytes = extractKb("MemAvailable:");
    const usedBytes = totalBytes - availableBytes;
    const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100 * 10) / 10 : 0;

    return { totalBytes, usedBytes, availableBytes, usagePercent };
  } catch {
    const totalBytes = totalmem();
    const availableBytes = freemem();
    const usedBytes = totalBytes - availableBytes;
    const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100 * 10) / 10 : 0;

    return { totalBytes, usedBytes, availableBytes, usagePercent };
  }
}

async function getDiskUsage(): Promise<
  Array<{
    mount: string;
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usagePercent: number;
  }>
> {
  if (process.platform === "win32") return [];

  const { execSync } = await import("node:child_process");
  try {
    const output = execSync("df -B1 --output=target,size,used,avail 2>/dev/null || df -k", {
      encoding: "utf-8",
      timeout: 5000,
    });

    const lines = output.trim().split("\n").slice(1);
    const disks: Array<{
      mount: string;
      totalBytes: number;
      usedBytes: number;
      availableBytes: number;
      usagePercent: number;
    }> = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4 || !parts[0] || !parts[1] || !parts[2] || !parts[3]) continue;

      const mount = parts[0];
      // Filter to physical mounts only
      if (!mount.startsWith("/dev/") && !mount.startsWith("/host/")) continue;

      const totalBytes = parseInt(parts[1], 10);
      const usedBytes = parseInt(parts[2], 10);
      const availableBytes = parseInt(parts[3], 10);
      const usagePercent =
        totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100 * 10) / 10 : 0;

      disks.push({ mount, totalBytes, usedBytes, availableBytes, usagePercent });
    }

    return disks;
  } catch {
    return [];
  }
}

export function statsRoutes({ db }: StatsRouteDeps) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.get("/system", async (c) => {
    const [cpu, memory, disk] = await Promise.all([
      getCpuUsage(),
      getMemoryUsage(),
      getDiskUsage(),
    ]);

    return c.json({
      data: {
        cpu,
        memory,
        disk,
        timestamp: new Date().toISOString(),
      },
    });
  });

  app.get("/storage", async (c) => {
    const [
      fileCountResult,
      totalSizeResult,
      ssdFilesResult,
      hddFilesResult,
      folderCountResult,
      userCountResult,
      activeSessionsResult,
    ] = await Promise.all([
      db.select({ count: count() }).from(files),
      db.select({ total: sum(files.sizeBytes) }).from(files),
      db
        .select({ count: count(), total: sum(files.sizeBytes) })
        .from(files)
        .where(eq(files.tier, "ssd")),
      db
        .select({ count: count(), total: sum(files.sizeBytes) })
        .from(files)
        .where(eq(files.tier, "hdd")),
      db.select({ count: count() }).from(folders),
      db.select({ count: count() }).from(users),
      db.select({ count: count() }).from(sessions).where(gt(sessions.expiresAt, new Date())),
    ]);

    return c.json({
      data: {
        files: {
          count: fileCountResult[0]?.count ?? 0,
          totalSizeBytes: parseInt(String(totalSizeResult[0]?.total ?? "0"), 10),
        },
        tiers: {
          ssd: {
            fileCount: ssdFilesResult[0]?.count ?? 0,
            totalSizeBytes: parseInt(String(ssdFilesResult[0]?.total ?? "0"), 10),
          },
          hdd: {
            fileCount: hddFilesResult[0]?.count ?? 0,
            totalSizeBytes: parseInt(String(hddFilesResult[0]?.total ?? "0"), 10),
          },
        },
        folders: { count: folderCountResult[0]?.count ?? 0 },
        users: { count: userCountResult[0]?.count ?? 0 },
        activeSessions: { count: activeSessionsResult[0]?.count ?? 0 },
        timestamp: new Date().toISOString(),
      },
    });
  });

  return app;
}
