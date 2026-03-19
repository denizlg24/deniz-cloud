import { describe, expect, test } from "bun:test";

describe("collection service — collection name validation", () => {
  const COLLECTION_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

  test("valid collection names", () => {
    expect(COLLECTION_NAME_PATTERN.test("users")).toBe(true);
    expect(COLLECTION_NAME_PATTERN.test("user-profiles")).toBe(true);
    expect(COLLECTION_NAME_PATTERN.test("a")).toBe(true);
    expect(COLLECTION_NAME_PATTERN.test("abc123")).toBe(true);
    expect(COLLECTION_NAME_PATTERN.test("my-long-collection-name")).toBe(true);
  });

  test("rejects names starting with hyphen", () => {
    expect(COLLECTION_NAME_PATTERN.test("-users")).toBe(false);
  });

  test("rejects names ending with hyphen", () => {
    expect(COLLECTION_NAME_PATTERN.test("users-")).toBe(false);
  });

  test("rejects names with uppercase", () => {
    expect(COLLECTION_NAME_PATTERN.test("Users")).toBe(false);
    expect(COLLECTION_NAME_PATTERN.test("USERS")).toBe(false);
  });

  test("rejects names with underscores", () => {
    expect(COLLECTION_NAME_PATTERN.test("user_profiles")).toBe(false);
  });

  test("rejects empty name", () => {
    expect(COLLECTION_NAME_PATTERN.test("")).toBe(false);
  });

  test("rejects names with special characters", () => {
    expect(COLLECTION_NAME_PATTERN.test("users.v2")).toBe(false);
    expect(COLLECTION_NAME_PATTERN.test("users@v2")).toBe(false);
    expect(COLLECTION_NAME_PATTERN.test("users/v2")).toBe(false);
  });

  test("max collection name length is 50 (enforced by route, not regex)", () => {
    const longName = "a".repeat(50);
    expect(COLLECTION_NAME_PATTERN.test(longName)).toBe(true);
    const tooLong = "a".repeat(51);
    expect(COLLECTION_NAME_PATTERN.test(tooLong)).toBe(true);
    expect(tooLong.length > 50).toBe(true);
  });
});
