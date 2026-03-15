const BASE = "/api";

interface ApiError {
  error: { code: string; message: string };
  requiresRecoveryCode?: boolean;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requiresRecoveryCode?: boolean;

  constructor(status: number, code: string, requiresRecoveryCode?: boolean) {
    super(code);
    this.name = "ApiRequestError";
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
    );
  }

  return res.json() as Promise<T>;
}

export interface SafeUser {
  id: string;
  username: string;
  email: string | null;
  role: "superuser" | "user";
  totpEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface LoginResponse {
  data: {
    expiresAt: string;
    user: SafeUser;
  };
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

import type {
  FolderContents,
  Pagination,
  RootFolders,
  StorageFile,
  StorageFileDetail,
  StorageFolder,
  StorageFolderDetail,
} from "./types";

interface RootsResponse {
  data: RootFolders;
}

export async function fetchRoots(): Promise<RootFolders> {
  const res = await request<RootsResponse>("/folders/roots");
  return res.data;
}

interface FolderContentsResponse {
  data: {
    folder: FolderContents["folder"];
    subfolders: StorageFolder[];
    files: StorageFile[];
  };
  pagination: Pagination;
}

export async function fetchFolderContents(
  folderId: string,
  page = 1,
  limit = 50,
): Promise<FolderContents> {
  const res = await request<FolderContentsResponse>(
    `/folders/${folderId}/contents?page=${page}&limit=${limit}`,
  );
  return {
    folder: res.data.folder,
    subfolders: res.data.subfolders,
    files: res.data.files,
    pagination: res.pagination,
  };
}

interface FolderDetailResponse {
  data: StorageFolderDetail;
}

export async function fetchFolder(folderId: string): Promise<StorageFolderDetail> {
  const res = await request<FolderDetailResponse>(`/folders/${folderId}`);
  return res.data;
}

interface CreateFolderResponse {
  data: StorageFolder;
}

export async function createFolder(name: string, parentId: string): Promise<StorageFolder> {
  const res = await request<CreateFolderResponse>("/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, parentId }),
  });
  return res.data;
}

interface RenameFolderResponse {
  data: { id: string; path: string; name: string; parentId: string | null };
}

export async function renameFolder(
  folderId: string,
  name: string,
): Promise<RenameFolderResponse["data"]> {
  const res = await request<RenameFolderResponse>(`/folders/${folderId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return res.data;
}

export async function deleteFolder(folderId: string): Promise<void> {
  await request(`/folders/${folderId}`, { method: "DELETE" });
}

interface FileDetailResponse {
  data: StorageFileDetail;
}

export async function fetchFileDetail(fileId: string): Promise<StorageFileDetail> {
  const res = await request<FileDetailResponse>(`/files/${fileId}`);
  return res.data;
}

interface RenameFileResponse {
  data: { id: string; filename: string; path: string; folderId: string };
}

export async function renameFile(
  fileId: string,
  filename: string,
): Promise<RenameFileResponse["data"]> {
  const res = await request<RenameFileResponse>(`/files/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  return res.data;
}

export async function moveFile(
  fileId: string,
  folderId: string,
): Promise<RenameFileResponse["data"]> {
  const res = await request<RenameFileResponse>(`/files/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderId }),
  });
  return res.data;
}

export async function deleteFile(fileId: string): Promise<void> {
  await request(`/files/${fileId}`, { method: "DELETE" });
}

export function getDownloadUrl(fileId: string, forceDownload = false): string {
  const base = `${BASE}/files/${fileId}/download`;
  return forceDownload ? `${base}?download` : base;
}
