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

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  ownerId: string;
  storageFolderId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProjectsListResponse {
  data: Project[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export async function getProjects(page = 1, limit = 50): Promise<ProjectsListResponse> {
  return request<ProjectsListResponse>(`/projects?page=${page}&limit=${limit}`);
}

export async function getProject(id: string): Promise<Project> {
  const res = await request<{ data: Project }>(`/projects/${id}`);
  return res.data;
}

export async function createProject(input: {
  name: string;
  slug: string;
  description?: string;
}): Promise<Project> {
  const res = await request<{ data: Project }>("/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function updateProject(
  id: string,
  input: { name?: string; description?: string },
): Promise<Project> {
  const res = await request<{ data: Project }>(`/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function deleteProject(id: string): Promise<void> {
  await request(`/projects/${id}`, { method: "DELETE" });
}

export interface ApiKey {
  id: string;
  userId: string;
  projectId: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export async function getApiKeys(projectId: string): Promise<ApiKey[]> {
  const res = await request<{ data: ApiKey[] }>(`/projects/${projectId}/api-keys`);
  return res.data;
}

export async function createApiKey(
  projectId: string,
  input: { name: string; scopes: string[]; expiresIn?: string },
): Promise<{ id: string; key: string; prefix: string }> {
  const res = await request<{
    data: { id: string; key: string; prefix: string };
  }>(`/projects/${projectId}/api-keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function revokeApiKey(projectId: string, keyId: string): Promise<void> {
  await request(`/projects/${projectId}/api-keys/${keyId}`, {
    method: "DELETE",
  });
}

export interface FieldMapping {
  includeFields?: string[];
  excludeFields?: string[];
  searchableAttributes?: string[];
  filterableAttributes?: string[];
  sortableAttributes?: string[];
  primaryKey?: string;
}

export interface ProjectCollection {
  id: string;
  projectId: string;
  name: string;
  mongoDatabase: string;
  mongoCollection: string;
  meiliIndexUid: string;
  fieldMapping: FieldMapping;
  syncEnabled: boolean;
  syncStatus: "idle" | "syncing" | "error";
  resumeToken: Record<string, unknown> | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

export async function getCollections(projectId: string): Promise<ProjectCollection[]> {
  const res = await request<{ data: ProjectCollection[] }>(`/projects/${projectId}/collections`);
  return res.data;
}

export async function createCollectionApi(
  projectId: string,
  input: {
    name: string;
    mongoDatabase: string;
    mongoCollection: string;
    fieldMapping?: FieldMapping;
  },
): Promise<ProjectCollection> {
  const res = await request<{ data: ProjectCollection }>(`/projects/${projectId}/collections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function updateCollectionApi(
  projectId: string,
  collectionId: string,
  input: { fieldMapping?: FieldMapping; syncEnabled?: boolean },
): Promise<ProjectCollection> {
  const res = await request<{ data: ProjectCollection }>(
    `/projects/${projectId}/collections/${collectionId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return res.data;
}

export async function deleteCollectionApi(projectId: string, collectionId: string): Promise<void> {
  await request(`/projects/${projectId}/collections/${collectionId}`, {
    method: "DELETE",
  });
}

export async function resyncCollection(projectId: string, collectionId: string): Promise<void> {
  await request(`/projects/${projectId}/collections/${collectionId}/resync`, {
    method: "POST",
  });
}

export interface DiscoveredField {
  name: string;
  types: string[];
}

export async function discoverFields(
  projectId: string,
  mongoDatabase: string,
  mongoCollection: string,
): Promise<{ fields: DiscoveredField[]; sampleCount: number }> {
  const res = await request<{
    data: { fields: DiscoveredField[]; sampleCount: number };
  }>(`/projects/${projectId}/collections/discover-fields`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mongoDatabase, mongoCollection }),
  });
  return res.data;
}
