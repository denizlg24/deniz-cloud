import { describe, expect, test } from "bun:test";
import { parseScopedIndexName, scopedIndexName } from "../indexes";

describe("search indexes", () => {
  describe("scopedIndexName", () => {
    test("joins project and collection with underscore", () => {
      expect(scopedIndexName("myapp", "users")).toBe("myapp_users");
    });

    test("handles hyphenated names", () => {
      expect(scopedIndexName("my-app", "user-profiles")).toBe("my-app_user-profiles");
    });
  });

  describe("parseScopedIndexName", () => {
    test("parses project and collection from index UID", () => {
      const result = parseScopedIndexName("myapp_users");
      expect(result).toEqual({ project: "myapp", collection: "users" });
    });

    test("handles collection names with underscores", () => {
      // First underscore is the separator
      const result = parseScopedIndexName("myapp_user_profiles");
      expect(result).toEqual({
        project: "myapp",
        collection: "user_profiles",
      });
    });

    test("returns null for invalid format (no underscore)", () => {
      expect(parseScopedIndexName("nounderscore")).toBeNull();
    });

    test("handles single-char project name", () => {
      const result = parseScopedIndexName("a_items");
      expect(result).toEqual({ project: "a", collection: "items" });
    });
  });
});
