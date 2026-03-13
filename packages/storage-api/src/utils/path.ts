const INVALID_SEGMENTS = new Set([".", ".."]);
const MAX_SEGMENT_LENGTH = 255;

export function toSnakeCase(input: string): string {
  return (
    input
      // Replace spaces, hyphens with underscores (preserve dots for file extensions)
      .replace(/[\s-]+/g, "_")
      // Insert underscore between lowercase/digit and uppercase: camelCase → camel_Case
      .replace(/([a-z\d])([A-Z])/g, "$1_$2")
      // Insert underscore between acronym and word: APIKeys → API_Keys, HTMLParser → HTML_Parser
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
      .toLowerCase()
      // Collapse multiple underscores
      .replace(/_+/g, "_")
      // Trim leading/trailing underscores
      .replace(/^_|_$/g, "")
  );
}

export function validatePathSegment(segment: string): void {
  if (!segment) {
    throw new PathValidationError("Path segment cannot be empty");
  }
  if (INVALID_SEGMENTS.has(segment)) {
    throw new PathValidationError(`Invalid path segment: "${segment}"`);
  }
  if (segment.includes("\0")) {
    throw new PathValidationError("Path segment contains null byte");
  }
  if (segment.length > MAX_SEGMENT_LENGTH) {
    throw new PathValidationError(`Path segment exceeds ${MAX_SEGMENT_LENGTH} characters`);
  }
  if (/[<>:"|?*\\]/.test(segment)) {
    throw new PathValidationError(`Path segment contains invalid characters: "${segment}"`);
  }
}

export function validatePath(path: string): void {
  if (!path.startsWith("/")) {
    throw new PathValidationError("Path must start with /");
  }
  if (path !== "/" && path.endsWith("/")) {
    throw new PathValidationError("Path must not end with /");
  }
  if (path.includes("//")) {
    throw new PathValidationError("Path must not contain double slashes");
  }
  const segments = path.split("/").filter(Boolean);
  for (const segment of segments) {
    validatePathSegment(segment);
  }
}

export function normalizeName(name: string): string {
  const normalized = toSnakeCase(name);
  if (!normalized) {
    throw new PathValidationError("Name is empty after normalization");
  }
  validatePathSegment(normalized);
  return normalized;
}

export function normalizeFileName(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) {
    return normalizeName(name);
  }
  const stem = name.slice(0, dotIndex);
  const ext = name.slice(dotIndex + 1);
  return `${normalizeName(stem)}.${ext.toLowerCase()}`;
}

export function joinPath(...segments: string[]): string {
  const joined = `/${segments
    .map((s) => s.replace(/^\/|\/$/g, ""))
    .filter(Boolean)
    .join("/")}`;
  return joined === "" ? "/" : joined;
}

export function resolveSsdDiskPath(basePath: string, virtualPath: string): string {
  return joinPath(basePath, virtualPath);
}

export function resolveHddDiskPath(basePath: string, fileId: string): string {
  return joinPath(basePath, fileId);
}

export function buildUserRootPath(userId: string): string {
  return `/${userId}`;
}

export const SHARED_ROOT_PATH = "/shared";

export function isSharedPath(path: string): boolean {
  return path === SHARED_ROOT_PATH || path.startsWith(`${SHARED_ROOT_PATH}/`);
}

export class PathValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathValidationError";
  }
}
