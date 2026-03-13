import { describe, expect, test } from "bun:test";
import { parseScopedIndexName, scopedIndexName } from "../indexes";

describe("search indexes — extended edge cases", () => {
  describe("scopedIndexName", () => {
    test("handles empty project name", () => {
      expect(scopedIndexName("", "users")).toBe("_users");
    });

    test("handles empty collection name", () => {
      expect(scopedIndexName("myapp", "")).toBe("myapp_");
    });

    test("handles both empty", () => {
      expect(scopedIndexName("", "")).toBe("_");
    });

    test("handles names with special characters", () => {
      expect(scopedIndexName("my-app", "user-profiles")).toBe("my-app_user-profiles");
    });

    test("handles names that already contain underscores", () => {
      // This is a naming collision risk: project "a" + collection "b_c"
      // produces same index as project "a_b" + collection "c"
      const index1 = scopedIndexName("a", "b_c");
      const index2 = scopedIndexName("a_b", "c");
      // Document this collision behavior
      expect(index1).toBe("a_b_c");
      expect(index2).toBe("a_b_c");
      // They ARE the same — the naming convention has this collision risk
      expect(index1).toBe(index2);
    });

    test("handles very long names", () => {
      const longProject = "p".repeat(100);
      const longCollection = "c".repeat(100);
      expect(scopedIndexName(longProject, longCollection)).toBe(
        `${"p".repeat(100)}_${"c".repeat(100)}`,
      );
    });
  });

  describe("parseScopedIndexName", () => {
    test("returns null for empty string", () => {
      expect(parseScopedIndexName("")).toBeNull();
    });

    test("returns null for string without underscore", () => {
      expect(parseScopedIndexName("nounderscore")).toBeNull();
    });

    test("handles index with underscore at start", () => {
      // "_users" → project: "", collection: "users"
      const result = parseScopedIndexName("_users");
      expect(result).toEqual({ project: "", collection: "users" });
    });

    test("handles index with underscore at end", () => {
      // "myapp_" → project: "myapp", collection: ""
      const result = parseScopedIndexName("myapp_");
      expect(result).toEqual({ project: "myapp", collection: "" });
    });

    test("handles index with only underscore", () => {
      const result = parseScopedIndexName("_");
      expect(result).toEqual({ project: "", collection: "" });
    });

    test("splits on first underscore only", () => {
      // "a_b_c" → project: "a", collection: "b_c"
      const result = parseScopedIndexName("a_b_c");
      expect(result).toEqual({ project: "a", collection: "b_c" });
    });

    test("round-trips with scopedIndexName", () => {
      const project = "myapp";
      const collection = "users";
      const indexName = scopedIndexName(project, collection);
      const parsed = parseScopedIndexName(indexName);
      expect(parsed).toEqual({ project, collection });
    });

    test("round-trip with hyphenated names", () => {
      const project = "my-app";
      const collection = "user-profiles";
      const indexName = scopedIndexName(project, collection);
      const parsed = parseScopedIndexName(indexName);
      expect(parsed).toEqual({ project, collection });
    });

    test("does NOT round-trip when collection contains underscores (known limitation)", () => {
      // Project "a" + collection "b_c" → index "a_b_c"
      // Parsing "a_b_c" → project "a", collection "b_c" ← happens to be correct
      // But: Project "a_b" + collection "c" → index "a_b_c"
      // Parsing "a_b_c" → project "a", collection "b_c" ← WRONG for this case
      const index = scopedIndexName("a_b", "c");
      const parsed = parseScopedIndexName(index);
      // This documents the known limitation
      expect(parsed?.project).toBe("a"); // Wrong — should be "a_b"
      expect(parsed?.collection).toBe("b_c"); // Wrong — should be "c"
    });
  });
});
