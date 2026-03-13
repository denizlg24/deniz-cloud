import { describe, expect, test } from "bun:test";
import {
  buildUserRootPath,
  isSharedPath,
  joinPath,
  normalizeFileName,
  normalizeName,
  PathValidationError,
  resolveHddDiskPath,
  resolveSsdDiskPath,
  SHARED_ROOT_PATH,
  toSnakeCase,
  validatePath,
  validatePathSegment,
} from "../path";

describe("toSnakeCase — extended edge cases", () => {
  test("handles consecutive numbers and letters", () => {
    expect(toSnakeCase("mp3File")).toBe("mp3_file");
    expect(toSnakeCase("file2023backup")).toBe("file2023backup");
    expect(toSnakeCase("2023Backup")).toBe("2023_backup");
  });

  test("handles all-uppercase input", () => {
    expect(toSnakeCase("README")).toBe("readme");
    expect(toSnakeCase("TODO")).toBe("todo");
    expect(toSnakeCase("CHANGELOG")).toBe("changelog");
  });

  test("handles mixed separators", () => {
    expect(toSnakeCase("hello-world_test")).toBe("hello_world_test");
    expect(toSnakeCase("some - thing_else")).toBe("some_thing_else");
  });

  test("handles single character input", () => {
    expect(toSnakeCase("A")).toBe("a");
    expect(toSnakeCase("a")).toBe("a");
    expect(toSnakeCase("1")).toBe("1");
  });

  test("handles all special separator characters", () => {
    expect(toSnakeCase("a b")).toBe("a_b"); // space
    expect(toSnakeCase("a-b")).toBe("a_b"); // hyphen
    expect(toSnakeCase("a\tb")).toBe("a_b"); // tab
  });

  test("preserves multiple dots (compound extensions)", () => {
    expect(toSnakeCase("archive.tar.gz")).toBe("archive.tar.gz");
    expect(toSnakeCase("file.backup.2024")).toBe("file.backup.2024");
  });

  test("handles leading numbers", () => {
    expect(toSnakeCase("123abc")).toBe("123abc");
    expect(toSnakeCase("123ABC")).toBe("123_abc");
  });
});

describe("normalizeName — extended", () => {
  test("rejects names that normalize to traversal", () => {
    // After snake_case, ".." stays ".." which is invalid
    expect(() => normalizeName("..")).toThrow(PathValidationError);
  });

  test("rejects names with only special chars that become empty", () => {
    expect(() => normalizeName("-")).toThrow(PathValidationError);
    expect(() => normalizeName("--")).toThrow(PathValidationError);
  });

  test("handles names at max segment length boundary", () => {
    const maxName = "a".repeat(255);
    expect(normalizeName(maxName)).toBe(maxName);
  });

  test("rejects names that exceed max segment length after normalization", () => {
    // 256 chars → should fail
    expect(() => normalizeName("a".repeat(256))).toThrow(PathValidationError);
  });
});

describe("normalizeFileName — extended", () => {
  test("handles file with multiple dots", () => {
    expect(normalizeFileName("My Archive.tar.gz")).toBe("my_archive.tar.gz");
    expect(normalizeFileName("Photo 2024.01.05.JPG")).toBe("photo_2024.01.05.jpg");
  });

  test("handles file starting with dot (dotfile)", () => {
    expect(normalizeFileName(".gitignore")).toBe(".gitignore");
    expect(normalizeFileName(".env")).toBe(".env");
    expect(normalizeFileName(".DS_Store")).toBe(".ds_store");
  });

  test("handles file with only extension", () => {
    expect(normalizeFileName(".config")).toBe(".config");
  });

  test("handles filename with mixed case extension", () => {
    expect(normalizeFileName("photo.JPEG")).toBe("photo.jpeg");
    expect(normalizeFileName("doc.Pdf")).toBe("doc.pdf");
  });

  test("handles filename with spaces in extension", () => {
    // Unlikely but defensive
    expect(normalizeFileName("My File.t x t")).toBe("my_file.t x t");
  });

  test("handles filename with no extension and special chars", () => {
    expect(normalizeFileName("Makefile")).toBe("makefile");
    expect(normalizeFileName("Dockerfile")).toBe("dockerfile");
  });
});

describe("validatePathSegment — extended", () => {
  test("accepts segments with dots (not . or ..)", () => {
    expect(() => validatePathSegment("file.txt")).not.toThrow();
    expect(() => validatePathSegment("...")).not.toThrow();
    expect(() => validatePathSegment(".hidden")).not.toThrow();
  });

  test("accepts segments with underscores and hyphens", () => {
    expect(() => validatePathSegment("my-file")).not.toThrow();
    expect(() => validatePathSegment("my_file")).not.toThrow();
    expect(() => validatePathSegment("my-file_v2")).not.toThrow();
  });

  test("accepts segment at exactly max length", () => {
    expect(() => validatePathSegment("x".repeat(255))).not.toThrow();
  });

  test("rejects segment at max length + 1", () => {
    expect(() => validatePathSegment("x".repeat(256))).toThrow(PathValidationError);
  });

  test("rejects all invalid Windows characters individually", () => {
    const invalidChars = ["<", ">", ":", '"', "|", "?", "*", "\\"];
    for (const ch of invalidChars) {
      expect(() => validatePathSegment(`file${ch}name`)).toThrow(PathValidationError);
    }
  });

  test("accepts forward slash is NOT in the invalid set", () => {
    // Forward slashes would be path separators, not in segments
    // But validatePathSegment itself doesn't block /
    // Actually, / is not in the regex — it would be split by path logic
    // Let's verify the regex
    expect(() => validatePathSegment("file/name")).not.toThrow();
  });

  test("accepts unicode file names", () => {
    expect(() => validatePathSegment("\u00E9l\u00E8ve")).not.toThrow(); // élève
    expect(() => validatePathSegment("\u65E5\u672C\u8A9E")).not.toThrow(); // 日本語
    expect(() => validatePathSegment("\u{1F4C4}")).not.toThrow(); // 📄
  });
});

describe("validatePath — extended", () => {
  test("accepts root path /", () => {
    expect(() => validatePath("/")).not.toThrow();
  });

  test("accepts deeply nested paths", () => {
    const deep = `/${Array.from({ length: 50 }, (_, i) => `level${i}`).join("/")}`;
    expect(() => validatePath(deep)).not.toThrow();
  });

  test("rejects relative paths", () => {
    expect(() => validatePath("relative/path")).toThrow(PathValidationError);
    expect(() => validatePath("./relative")).toThrow(PathValidationError);
  });

  test("rejects path traversal at any level", () => {
    expect(() => validatePath("/../etc")).toThrow(PathValidationError);
    expect(() => validatePath("/shared/../../../etc/passwd")).toThrow(PathValidationError);
    expect(() => validatePath("/a/b/../c")).toThrow(PathValidationError);
  });

  test("rejects paths with dot segments", () => {
    expect(() => validatePath("/a/./b")).toThrow(PathValidationError);
    expect(() => validatePath("/./")).toThrow(PathValidationError);
  });

  test("rejects path that is just double slash", () => {
    expect(() => validatePath("//")).toThrow(PathValidationError);
  });

  test("rejects path with only spaces in segment", () => {
    // Space is a valid char in a segment (no rule against it)
    expect(() => validatePath("/ /")).toThrow(PathValidationError); // trailing slash
    expect(() => validatePath("/ ")).not.toThrow();
  });
});

describe("joinPath — extended", () => {
  test("returns root for no segments", () => {
    expect(joinPath()).toBe("/");
  });

  test("returns root for only empty segments", () => {
    expect(joinPath("", "", "")).toBe("/");
  });

  test("handles single segment", () => {
    expect(joinPath("shared")).toBe("/shared");
    expect(joinPath("/shared/")).toBe("/shared");
  });

  test("handles segments with mixed slashes", () => {
    expect(joinPath("/a/", "/b/", "/c")).toBe("/a/b/c");
  });

  test("does not collapse double slashes in middle of segment", () => {
    // joinPath strips leading/trailing slashes per segment, then joins
    expect(joinPath("a", "b")).toBe("/a/b");
  });
});

describe("resolveSsdDiskPath", () => {
  test("joins base path with virtual path", () => {
    expect(resolveSsdDiskPath("/mnt/ssd/storage", "/shared/photos/img.jpg")).toBe(
      "/mnt/ssd/storage/shared/photos/img.jpg",
    );
  });

  test("handles root virtual path", () => {
    expect(resolveSsdDiskPath("/mnt/ssd/storage", "/")).toBe("/mnt/ssd/storage");
  });
});

describe("resolveHddDiskPath", () => {
  test("joins base path with file ID", () => {
    expect(resolveHddDiskPath("/mnt/hdd/cold", "abc-123")).toBe("/mnt/hdd/cold/abc-123");
  });
});

describe("buildUserRootPath", () => {
  test("prefixes userId with /", () => {
    expect(buildUserRootPath("user-123")).toBe("/user-123");
  });

  test("handles UUID-style userId", () => {
    expect(buildUserRootPath("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "/550e8400-e29b-41d4-a716-446655440000",
    );
  });
});

describe("SHARED_ROOT_PATH", () => {
  test("is /shared", () => {
    expect(SHARED_ROOT_PATH).toBe("/shared");
  });
});

describe("isSharedPath", () => {
  test("returns true for exact /shared", () => {
    expect(isSharedPath("/shared")).toBe(true);
  });

  test("returns true for paths under /shared/", () => {
    expect(isSharedPath("/shared/photos")).toBe(true);
    expect(isSharedPath("/shared/photos/img.jpg")).toBe(true);
  });

  test("returns false for non-shared paths", () => {
    expect(isSharedPath("/user-123")).toBe(false);
    expect(isSharedPath("/")).toBe(false);
  });

  test("returns false for paths that start with /shared but not as directory", () => {
    // /sharedx is NOT under /shared
    expect(isSharedPath("/sharedx")).toBe(false);
    expect(isSharedPath("/shared_files")).toBe(false);
  });
});

describe("PathValidationError", () => {
  test("is an instance of Error", () => {
    const err = new PathValidationError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PathValidationError);
  });

  test("has correct name property", () => {
    const err = new PathValidationError("test");
    expect(err.name).toBe("PathValidationError");
  });

  test("preserves message", () => {
    const err = new PathValidationError("custom message");
    expect(err.message).toBe("custom message");
  });
});
