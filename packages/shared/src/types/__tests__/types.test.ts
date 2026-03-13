import { describe, expect, it } from "bun:test";
import type {
  ApiErrorResponse,
  ApiResponse,
  PaginatedResponse,
  SafeApiKey,
  SafeSession,
  SafeUser,
} from "../index";

describe("SafeUser", () => {
  it("includes all User fields except passwordHash", () => {
    // Build a SafeUser — this should compile without passwordHash
    const safeUser: SafeUser = {
      id: "u1",
      username: "admin",
      email: "admin@test.com",
      role: "superuser",
      totpEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(safeUser.id).toBe("u1");
    expect(safeUser.username).toBe("admin");
    expect(safeUser).not.toHaveProperty("passwordHash");
  });

  it("type-level: passwordHash is not assignable to SafeUser", () => {
    // This is a compile-time test. If SafeUser incorrectly included
    // passwordHash, the Omit would be wrong.
    type HasPasswordHash = "passwordHash" extends keyof SafeUser ? true : false;
    const check: HasPasswordHash = false;
    expect(check).toBe(false);
  });

  it("includes all expected fields", () => {
    type ExpectedFields =
      | "id"
      | "username"
      | "email"
      | "role"
      | "totpEnabled"
      | "createdAt"
      | "updatedAt";

    // If any field is missing from SafeUser, this line would fail to compile
    type AllPresent = ExpectedFields extends keyof SafeUser ? true : false;
    const check: AllPresent = true;
    expect(check).toBe(true);
  });
});

describe("SafeSession", () => {
  it("omits tokenHash", () => {
    type HasTokenHash = "tokenHash" extends keyof SafeSession ? true : false;
    const check: HasTokenHash = false;
    expect(check).toBe(false);
  });

  it("includes session fields except tokenHash", () => {
    const session: SafeSession = {
      id: "s1",
      userId: "u1",
      expiresAt: new Date(),
      createdAt: new Date(),
    };

    expect(session.id).toBe("s1");
    expect(session.userId).toBe("u1");
  });
});

describe("SafeApiKey", () => {
  it("omits keyHash", () => {
    type HasKeyHash = "keyHash" extends keyof SafeApiKey ? true : false;
    const check: HasKeyHash = false;
    expect(check).toBe(false);
  });

  it("includes api key fields except keyHash", () => {
    const apiKey: SafeApiKey = {
      id: "ak1",
      userId: "u1",
      name: "My Key",
      keyPrefix: "dc_abc123",
      expiresAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
    };

    expect(apiKey.id).toBe("ak1");
    expect(apiKey.keyPrefix).toBe("dc_abc123");
  });
});

describe("ApiResponse", () => {
  it("wraps data of any type", () => {
    const stringResponse: ApiResponse<string> = { data: "hello" };
    expect(stringResponse.data).toBe("hello");

    const objectResponse: ApiResponse<{ id: string }> = { data: { id: "1" } };
    expect(objectResponse.data.id).toBe("1");

    const arrayResponse: ApiResponse<number[]> = { data: [1, 2, 3] };
    expect(arrayResponse.data).toEqual([1, 2, 3]);
  });

  it("has exactly one key: data", () => {
    const response: ApiResponse<null> = { data: null };
    expect(Object.keys(response)).toEqual(["data"]);
  });
});

describe("ApiErrorResponse", () => {
  it("has error with code and message", () => {
    const errResponse: ApiErrorResponse = {
      error: { code: "NOT_FOUND", message: "Resource not found" },
    };

    expect(errResponse.error.code).toBe("NOT_FOUND");
    expect(errResponse.error.message).toBe("Resource not found");
  });

  it("error code is a free-form string (not enum)", () => {
    // The type allows any string code — this is a design choice test
    const err: ApiErrorResponse = {
      error: { code: "CUSTOM_ERROR_CODE", message: "Something happened" },
    };
    expect(typeof err.error.code).toBe("string");
  });
});

describe("PaginatedResponse", () => {
  it("has data array and pagination metadata", () => {
    const response: PaginatedResponse<{ name: string }> = {
      data: [{ name: "item1" }, { name: "item2" }],
      pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
    };

    expect(response.data).toHaveLength(2);
    expect(response.pagination.page).toBe(1);
    expect(response.pagination.limit).toBe(20);
    expect(response.pagination.total).toBe(2);
    expect(response.pagination.totalPages).toBe(1);
  });

  it("data can be empty array", () => {
    const response: PaginatedResponse<string> = {
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    };

    expect(response.data).toEqual([]);
    expect(response.pagination.total).toBe(0);
  });

  it("pagination fields are all numbers", () => {
    const response: PaginatedResponse<unknown> = {
      data: [],
      pagination: { page: 5, limit: 10, total: 100, totalPages: 10 },
    };

    for (const value of Object.values(response.pagination)) {
      expect(typeof value).toBe("number");
    }
  });
});
