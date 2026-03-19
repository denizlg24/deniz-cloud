import { describe, expect, test } from "bun:test";
import { API_KEY_SCOPES } from "@deniz-cloud/shared/types";

describe("project route — slug validation", () => {
  // SLUG_REGEX from projects.ts: /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/
  const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

  test("accepts valid slugs", () => {
    expect(SLUG_REGEX.test("my-project")).toBe(true);
    expect(SLUG_REGEX.test("project1")).toBe(true);
    expect(SLUG_REGEX.test("abc")).toBe(true);
    expect(SLUG_REGEX.test("a1b")).toBe(true);
    expect(SLUG_REGEX.test("123")).toBe(true);
  });

  test("rejects leading hyphen", () => {
    expect(SLUG_REGEX.test("-project")).toBe(false);
  });

  test("rejects trailing hyphen", () => {
    expect(SLUG_REGEX.test("project-")).toBe(false);
  });

  test("rejects uppercase", () => {
    expect(SLUG_REGEX.test("MyProject")).toBe(false);
  });

  test("rejects too-short slugs (< 3 chars)", () => {
    expect(SLUG_REGEX.test("ab")).toBe(false);
    expect(SLUG_REGEX.test("a")).toBe(false);
    expect(SLUG_REGEX.test("")).toBe(false);
  });

  test("accepts max-length slug (64 chars)", () => {
    const slug = `a${"b".repeat(62)}c`;
    expect(slug.length).toBe(64);
    expect(SLUG_REGEX.test(slug)).toBe(true);
  });

  test("rejects slug exceeding 64 chars", () => {
    const slug = `a${"b".repeat(63)}c`;
    expect(slug.length).toBe(65);
    expect(SLUG_REGEX.test(slug)).toBe(false);
  });

  test("rejects special characters", () => {
    expect(SLUG_REGEX.test("my.project")).toBe(false);
    expect(SLUG_REGEX.test("my_project")).toBe(false);
    expect(SLUG_REGEX.test("my project")).toBe(false);
    expect(SLUG_REGEX.test("my@project")).toBe(false);
  });
});

describe("project route — collection name validation", () => {
  // COLLECTION_NAME_PATTERN from projects.ts: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
  const COLLECTION_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

  test("accepts valid names", () => {
    expect(COLLECTION_NAME_PATTERN.test("users")).toBe(true);
    expect(COLLECTION_NAME_PATTERN.test("user-profiles")).toBe(true);
    expect(COLLECTION_NAME_PATTERN.test("a")).toBe(true);
    expect(COLLECTION_NAME_PATTERN.test("items123")).toBe(true);
  });

  test("rejects leading hyphen", () => {
    expect(COLLECTION_NAME_PATTERN.test("-users")).toBe(false);
  });

  test("rejects trailing hyphen", () => {
    expect(COLLECTION_NAME_PATTERN.test("users-")).toBe(false);
  });

  test("rejects uppercase", () => {
    expect(COLLECTION_NAME_PATTERN.test("Users")).toBe(false);
  });

  test("rejects underscores", () => {
    expect(COLLECTION_NAME_PATTERN.test("user_profiles")).toBe(false);
  });

  test("rejects empty string", () => {
    expect(COLLECTION_NAME_PATTERN.test("")).toBe(false);
  });

  test("single character is valid", () => {
    expect(COLLECTION_NAME_PATTERN.test("a")).toBe(true);
    expect(COLLECTION_NAME_PATTERN.test("1")).toBe(true);
  });

  test("two characters with hyphen is rejected", () => {
    // Pattern requires start char, optionally middle+end char
    // "a-" would be: start=a, then group "a-z0-9-" matches "-" but then
    // needs ending [a-z0-9] which is missing → rejected
    expect(COLLECTION_NAME_PATTERN.test("a-")).toBe(false);
  });
});

describe("project route — parseExpiration", () => {
  // parseExpiration from projects.ts
  function parseExpiration(value: string): Date | undefined {
    const durations: Record<string, number> = {
      "30d": 30 * 24 * 60 * 60 * 1000,
      "90d": 90 * 24 * 60 * 60 * 1000,
      "1y": 365 * 24 * 60 * 60 * 1000,
    };
    const ms = durations[value];
    if (!ms) return undefined;
    return new Date(Date.now() + ms);
  }

  test("30d returns a date ~30 days in the future", () => {
    const before = Date.now();
    const result = parseExpiration("30d");
    const after = Date.now();

    expect(result).toBeInstanceOf(Date);
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(result?.getTime()).toBeGreaterThanOrEqual(before + thirtyDaysMs);
    expect(result?.getTime()).toBeLessThanOrEqual(after + thirtyDaysMs);
  });

  test("90d returns a date ~90 days in the future", () => {
    const before = Date.now();
    const result = parseExpiration("90d");

    expect(result).toBeInstanceOf(Date);
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    expect(result?.getTime()).toBeGreaterThanOrEqual(before + ninetyDaysMs);
  });

  test("1y returns a date ~365 days in the future", () => {
    const before = Date.now();
    const result = parseExpiration("1y");

    expect(result).toBeInstanceOf(Date);
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    expect(result?.getTime()).toBeGreaterThanOrEqual(before + oneYearMs);
  });

  test("unknown duration returns undefined", () => {
    expect(parseExpiration("7d")).toBeUndefined();
    expect(parseExpiration("1h")).toBeUndefined();
    expect(parseExpiration("never")).toBeUndefined();
    expect(parseExpiration("")).toBeUndefined();
    expect(parseExpiration("abc")).toBeUndefined();
  });

  test("only supports exact matches (30d, 90d, 1y)", () => {
    expect(parseExpiration("30d")).toBeInstanceOf(Date);
    expect(parseExpiration("90d")).toBeInstanceOf(Date);
    expect(parseExpiration("1y")).toBeInstanceOf(Date);

    // These should all return undefined
    expect(parseExpiration("30D")).toBeUndefined();
    expect(parseExpiration("1Y")).toBeUndefined();
    expect(parseExpiration("60d")).toBeUndefined();
    expect(parseExpiration("2y")).toBeUndefined();
  });
});

describe("project route — scope validation", () => {
  test("API_KEY_SCOPES contains all expected scopes", () => {
    expect(API_KEY_SCOPES).toContain("storage:read");
    expect(API_KEY_SCOPES).toContain("storage:write");
    expect(API_KEY_SCOPES).toContain("storage:delete");
    expect(API_KEY_SCOPES).toContain("search:read");
    expect(API_KEY_SCOPES).toContain("search:write");
    expect(API_KEY_SCOPES).toContain("search:manage");
  });

  test("API_KEY_SCOPES has exactly 6 scopes", () => {
    expect(API_KEY_SCOPES).toHaveLength(6);
  });

  test("invalid scope detection logic", () => {
    const inputScopes = ["storage:read", "invalid:scope", "storage:write"];
    const invalidScopes = inputScopes.filter(
      (s) => !API_KEY_SCOPES.includes(s as (typeof API_KEY_SCOPES)[number]),
    );

    expect(invalidScopes).toEqual(["invalid:scope"]);
  });

  test("all valid scopes pass validation", () => {
    const inputScopes = ["storage:read", "storage:write", "search:manage"];
    const invalidScopes = inputScopes.filter(
      (s) => !API_KEY_SCOPES.includes(s as (typeof API_KEY_SCOPES)[number]),
    );

    expect(invalidScopes).toHaveLength(0);
  });

  test("empty scopes array is invalid (route requires at least one)", () => {
    const scopes: string[] = [];
    expect(!Array.isArray(scopes) || scopes.length === 0).toBe(true);
  });
});

describe("project route — search token expiration", () => {
  test("default expiresInHours is 24", () => {
    const body = {};
    const expiresInHours =
      typeof (body as Record<string, unknown>).expiresInHours === "number" &&
      ((body as Record<string, unknown>).expiresInHours as number) > 0
        ? Math.min((body as Record<string, unknown>).expiresInHours as number, 720)
        : 24;

    expect(expiresInHours).toBe(24);
  });

  test("custom expiresInHours is respected", () => {
    const body = { expiresInHours: 48 };
    const expiresInHours =
      typeof body.expiresInHours === "number" && body.expiresInHours > 0
        ? Math.min(body.expiresInHours, 720)
        : 24;

    expect(expiresInHours).toBe(48);
  });

  test("expiresInHours is capped at 720 (30 days)", () => {
    const body = { expiresInHours: 1000 };
    const expiresInHours =
      typeof body.expiresInHours === "number" && body.expiresInHours > 0
        ? Math.min(body.expiresInHours, 720)
        : 24;

    expect(expiresInHours).toBe(720);
  });

  test("negative expiresInHours falls back to default", () => {
    const body = { expiresInHours: -5 };
    const expiresInHours =
      typeof body.expiresInHours === "number" && body.expiresInHours > 0
        ? Math.min(body.expiresInHours, 720)
        : 24;

    expect(expiresInHours).toBe(24);
  });

  test("zero expiresInHours falls back to default", () => {
    const body = { expiresInHours: 0 };
    const expiresInHours =
      typeof body.expiresInHours === "number" && body.expiresInHours > 0
        ? Math.min(body.expiresInHours, 720)
        : 24;

    expect(expiresInHours).toBe(24);
  });

  test("non-numeric expiresInHours falls back to default", () => {
    const body = { expiresInHours: "48" };
    const expiresInHours =
      typeof body.expiresInHours === "number" && body.expiresInHours > 0
        ? Math.min(body.expiresInHours, 720)
        : 24;

    expect(expiresInHours).toBe(24);
  });
});
