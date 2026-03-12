import type { ApiKey, SearchProject, Session, User, UserRole } from "../db/schema";

export type SafeUser = Omit<User, "passwordHash">;

export type SafeSession = Omit<Session, "tokenHash">;

export type SafeApiKey = Omit<ApiKey, "keyHash">;

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

export type { SearchProject, UserRole };
