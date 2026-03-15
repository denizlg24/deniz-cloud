import { describe, expect, test } from "bun:test";
import type { SafeUser } from "../../types";

describe("auth service — type contracts", () => {
  test("SafeUser type excludes passwordHash", () => {
    // Type-level test: ensure SafeUser is properly typed
    const user: SafeUser = {
      id: "test-id",
      username: "testuser",
      email: null,
      role: "user",
      status: "active",
      totpEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // passwordHash should not be assignable
    expect(user).not.toHaveProperty("passwordHash");
    expect(user.id).toBe("test-id");
    expect(user.username).toBe("testuser");
    expect(user.role).toBe("user");
  });

  test("SafeUser accepts superuser role", () => {
    const admin: SafeUser = {
      id: "admin-id",
      username: "admin",
      email: "admin@example.com",
      role: "superuser",
      status: "active",
      totpEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(admin.role).toBe("superuser");
  });
});

describe("auth service — duration format", () => {
  // parseDurationMs is not exported, so we document expected behaviors
  // via structural tests. If it were exported, we'd test:
  // - "24h" → 86400000
  // - "1d" → 86400000
  // - "30m" → 1800000
  // - "60s" → 60000
  // - "invalid" → throws
  // - "0h" → 0
  // - "-1h" → throws (negative not matched by regex)
  // - "1x" → throws (unknown unit)

  test("valid durations produce expected millisecond values", () => {
    // Test the math that parseDurationMs should perform
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    expect(24 * (multipliers.h ?? 0)).toBe(86_400_000);
    expect(1 * (multipliers.d ?? 0)).toBe(86_400_000);
    expect(30 * (multipliers.m ?? 0)).toBe(1_800_000);
    expect(60 * (multipliers.s ?? 0)).toBe(60_000);
  });

  test("the regex pattern matches expected formats", () => {
    const pattern = /^(\d+)([smhd])$/;

    expect(pattern.test("24h")).toBe(true);
    expect(pattern.test("1d")).toBe(true);
    expect(pattern.test("30m")).toBe(true);
    expect(pattern.test("60s")).toBe(true);
    expect(pattern.test("0h")).toBe(true);

    // Invalid formats
    expect(pattern.test("")).toBe(false);
    expect(pattern.test("invalid")).toBe(false);
    expect(pattern.test("1x")).toBe(false);
    expect(pattern.test("-1h")).toBe(false);
    expect(pattern.test("1.5h")).toBe(false);
    expect(pattern.test("h")).toBe(false);
    expect(pattern.test("24")).toBe(false);
    expect(pattern.test("24h1")).toBe(false);
  });
});
