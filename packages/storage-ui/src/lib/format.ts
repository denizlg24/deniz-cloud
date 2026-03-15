export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

const MIME_CATEGORIES: Record<string, string[]> = {
  image: ["image/"],
  video: ["video/"],
  audio: ["audio/"],
  pdf: ["application/pdf"],
  archive: [
    "application/zip",
    "application/x-tar",
    "application/gzip",
    "application/x-7z-compressed",
    "application/x-rar-compressed",
  ],
  code: [
    "text/javascript",
    "application/javascript",
    "application/json",
    "text/html",
    "text/css",
    "text/xml",
    "application/xml",
    "text/x-python",
    "text/x-typescript",
    "application/typescript",
  ],
  text: ["text/"],
  document: [
    "application/msword",
    "application/vnd.openxmlformats-officedocument",
    "application/vnd.ms-",
  ],
  spreadsheet: [
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml",
    "text/csv",
  ],
};

export type FileCategory =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "archive"
  | "code"
  | "text"
  | "document"
  | "spreadsheet"
  | "unknown";

export function getFileCategory(mimeType: string | null): FileCategory {
  if (!mimeType) return "unknown";
  for (const [category, prefixes] of Object.entries(MIME_CATEGORIES)) {
    if (prefixes.some((p) => mimeType.startsWith(p))) {
      return category as FileCategory;
    }
  }
  return "unknown";
}

export function isPreviewable(mimeType: string | null): boolean {
  const cat = getFileCategory(mimeType);
  return ["image", "video", "audio", "pdf", "text", "code"].includes(cat);
}
