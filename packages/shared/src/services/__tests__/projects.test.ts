import { describe, expect, test } from "bun:test";

describe("project service — slug validation patterns", () => {
  const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

  test("valid slugs", () => {
    expect(SLUG_REGEX.test("my-project")).toBe(true);
    expect(SLUG_REGEX.test("project1")).toBe(true);
    expect(SLUG_REGEX.test("abc")).toBe(true);
    expect(SLUG_REGEX.test("a-b")).toBe(true);
    expect(SLUG_REGEX.test("a1b")).toBe(true);
    expect(SLUG_REGEX.test("my-really-long-project-name-here")).toBe(true);
  });

  test("rejects slugs starting with hyphen", () => {
    expect(SLUG_REGEX.test("-my-project")).toBe(false);
  });

  test("rejects slugs ending with hyphen", () => {
    expect(SLUG_REGEX.test("my-project-")).toBe(false);
  });

  test("rejects slugs with uppercase letters", () => {
    expect(SLUG_REGEX.test("My-Project")).toBe(false);
    expect(SLUG_REGEX.test("MYPROJECT")).toBe(false);
  });

  test("rejects slugs shorter than 3 characters", () => {
    expect(SLUG_REGEX.test("ab")).toBe(false);
    expect(SLUG_REGEX.test("a")).toBe(false);
  });

  test("rejects empty slug", () => {
    expect(SLUG_REGEX.test("")).toBe(false);
  });

  test("rejects slugs with underscores", () => {
    expect(SLUG_REGEX.test("my_project")).toBe(false);
  });

  test("rejects slugs with spaces", () => {
    expect(SLUG_REGEX.test("my project")).toBe(false);
  });

  test("rejects slugs with special characters", () => {
    expect(SLUG_REGEX.test("my.project")).toBe(false);
    expect(SLUG_REGEX.test("my@project")).toBe(false);
  });

  test("rejects slugs over 64 characters", () => {
    const longSlug = `a${"b".repeat(62)}c`;
    expect(SLUG_REGEX.test(longSlug)).toBe(true);

    const tooLongSlug = `a${"b".repeat(63)}c`;
    expect(SLUG_REGEX.test(tooLongSlug)).toBe(false);
  });
});
