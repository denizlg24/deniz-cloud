import type {
  ApiKey,
  FieldMapping,
  Project,
  ProjectCollection,
  Session,
  SyncStatus,
  User,
  UserRole,
  UserStatus,
} from "../db/schema";

export type SafeUser = Omit<User, "passwordHash">;

export type SafeSession = Omit<Session, "tokenHash">;

export type SafeApiKey = Omit<ApiKey, "keyHash">;

export type SafeProject = Project;

export type SafeProjectCollection = ProjectCollection;

export const API_KEY_SCOPES = [
  "storage:read",
  "storage:write",
  "storage:delete",
  "search:read",
  "search:write",
  "search:manage",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export interface ApiResponse<T> {
  data: T;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export type { FieldMapping, SyncStatus, UserRole, UserStatus };
