import { mkdir, readdir, rm, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function exec(command: string[]): Promise<ExecResult> {
  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function enforceRetention(dir: string, maxCount: number): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const withStats = await Promise.all(
    entries.map(async (name) => {
      const fullPath = join(dir, name);
      const s = await stat(fullPath);
      return { name, fullPath, mtime: s.mtimeMs, isDirectory: s.isDirectory() };
    }),
  );

  withStats.sort((a, b) => b.mtime - a.mtime);

  const toDelete = withStats.slice(maxCount);
  const deleted: string[] = [];

  for (const entry of toDelete) {
    if (entry.isDirectory) {
      await rm(entry.fullPath, { recursive: true, force: true });
    } else {
      await unlink(entry.fullPath);
    }
    deleted.push(entry.name);
  }

  return deleted;
}

export async function getFileSize(path: string): Promise<number> {
  const s = await stat(path);
  return s.size;
}

export async function getDirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await getDirSize(fullPath);
    } else {
      const s = await stat(fullPath);
      total += s.size;
    }
  }
  return total;
}
