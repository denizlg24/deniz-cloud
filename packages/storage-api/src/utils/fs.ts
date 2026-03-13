import { mkdir, rm, stat, statfs } from "node:fs/promises";

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function deleteFile(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

export async function deleteDir(dirPath: string): Promise<void> {
  await rm(dirPath, { recursive: true, force: true });
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function getFileSize(filePath: string): Promise<number> {
  const stats = await stat(filePath);
  return stats.size;
}

export async function computeChecksum(filePath: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const stream = Bun.file(filePath).stream();
  for await (const chunk of stream) {
    hasher.update(chunk);
  }
  return hasher.digest("hex");
}

export async function getDiskUsagePercent(dirPath: string): Promise<number> {
  const stats = await statfs(dirPath);
  const totalBytes = stats.blocks * stats.bsize;
  const availableBytes = stats.bavail * stats.bsize;
  if (totalBytes === 0) return 0;
  return ((totalBytes - availableBytes) / totalBytes) * 100;
}

export async function isDirEmpty(dirPath: string): Promise<boolean> {
  const glob = new Bun.Glob("*");
  for await (const _ of glob.scan({ cwd: dirPath })) {
    return false;
  }
  return true;
}
