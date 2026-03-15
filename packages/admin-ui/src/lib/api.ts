const BASE = "/api";

interface ApiError {
  error: { code: string; message: string };
  requiresRecoveryCode?: boolean;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requiresRecoveryCode?: boolean;

  constructor(status: number, code: string, requiresRecoveryCode?: boolean, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.requiresRecoveryCode = requiresRecoveryCode;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(options.headers ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  };

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(
      res.status,
      body?.error?.code ?? "UNKNOWN_ERROR",
      body?.requiresRecoveryCode,
      body?.error?.message,
    );
  }

  return res.json() as Promise<T>;
}

export interface SafeUser {
  id: string;
  username: string;
  email: string | null;
  role: "superuser" | "user";
  status: "pending" | "active";
  totpEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface LoginResponse {
  data: { expiresAt: string; user: SafeUser };
}

interface MeResponse {
  data: SafeUser;
}

export interface LoginInput {
  username: string;
  password: string;
  totpCode?: string;
  recoveryCode?: string;
}

export async function login(input: LoginInput): Promise<LoginResponse["data"]> {
  const res = await request<LoginResponse>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function getMe(): Promise<SafeUser> {
  const res = await request<MeResponse>("/auth/me");
  return res.data;
}

export async function logout(): Promise<void> {
  await request("/auth/logout", { method: "POST" });
}

interface UsersListResponse {
  data: SafeUser[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export async function getUsers(page = 1, limit = 50): Promise<UsersListResponse> {
  return request<UsersListResponse>(`/users?page=${page}&limit=${limit}`);
}

export async function createUser(
  username: string,
  role: "user" | "superuser" = "user",
): Promise<SafeUser> {
  const res = await request<{ data: SafeUser }>("/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, role }),
  });
  return res.data;
}

export async function deleteUser(userId: string): Promise<void> {
  await request(`/users/${userId}`, { method: "DELETE" });
}

export async function resetUserMfa(userId: string): Promise<void> {
  await request(`/users/${userId}/reset-mfa`, { method: "POST" });
}

export interface SystemStats {
  cpu: { usagePercent: number; cores: number };
  memory: {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usagePercent: number;
  };
  disk: Array<{
    mount: string;
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usagePercent: number;
  }>;
  timestamp: string;
}

export interface StorageStats {
  files: { count: number; totalSizeBytes: number };
  tiers: {
    ssd: { fileCount: number; totalSizeBytes: number };
    hdd: { fileCount: number; totalSizeBytes: number };
  };
  folders: { count: number };
  users: { count: number };
  activeSessions: { count: number };
  timestamp: string;
}

export async function getSystemStats(): Promise<SystemStats> {
  const res = await request<{ data: SystemStats }>("/stats/system");
  return res.data;
}

export async function getStorageStats(): Promise<StorageStats> {
  const res = await request<{ data: StorageStats }>("/stats/storage");
  return res.data;
}
