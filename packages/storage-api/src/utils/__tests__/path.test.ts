import { describe, expect, test } from "bun:test";
import {
  joinPath,
  normalizeFileName,
  normalizeName,
  PathValidationError,
  toSnakeCase,
  validatePath,
  validatePathSegment,
} from "../path";

describe("toSnakeCase", () => {
  test("converts PascalCase", () => {
    expect(toSnakeCase("PcBuild")).toBe("pc_build");
    expect(toSnakeCase("MyPhotos")).toBe("my_photos");
    expect(toSnakeCase("HelloWorld")).toBe("hello_world");
  });

  test("converts camelCase", () => {
    expect(toSnakeCase("myPhotos")).toBe("my_photos");
    expect(toSnakeCase("fileName")).toBe("file_name");
    expect(toSnakeCase("getHTTPResponse")).toBe("get_http_response");
  });

  test("handles acronyms", () => {
    expect(toSnakeCase("APIKeys")).toBe("api_keys");
    expect(toSnakeCase("HTMLParser")).toBe("html_parser");
    expect(toSnakeCase("parseJSON")).toBe("parse_json");
    expect(toSnakeCase("IOStream")).toBe("io_stream");
  });

  test("converts spaces and hyphens to underscores", () => {
    expect(toSnakeCase("hello world")).toBe("hello_world");
    expect(toSnakeCase("hello-world")).toBe("hello_world");
    expect(toSnakeCase("hello - world")).toBe("hello_world");
  });

  test("preserves dots", () => {
    expect(toSnakeCase("my.file")).toBe("my.file");
    expect(toSnakeCase("PcBuild.tar")).toBe("pc_build.tar");
  });

  test("collapses multiple underscores", () => {
    expect(toSnakeCase("hello__world")).toBe("hello_world");
    expect(toSnakeCase("a___b")).toBe("a_b");
  });

  test("trims leading/trailing underscores", () => {
    expect(toSnakeCase("_hello_")).toBe("hello");
    expect(toSnakeCase("__test__")).toBe("test");
  });

  test("handles already snake_case", () => {
    expect(toSnakeCase("already_snake")).toBe("already_snake");
  });

  test("handles single words", () => {
    expect(toSnakeCase("photos")).toBe("photos");
    expect(toSnakeCase("DOCS")).toBe("docs");
  });

  test("handles numbers", () => {
    expect(toSnakeCase("file2share")).toBe("file2share");
    expect(toSnakeCase("version2Release")).toBe("version2_release");
  });
});

describe("normalizeName", () => {
  test("normalizes folder names", () => {
    expect(normalizeName("My Photos")).toBe("my_photos");
    expect(normalizeName("PcBuild")).toBe("pc_build");
  });

  test("throws on empty result", () => {
    expect(() => normalizeName("")).toThrow(PathValidationError);
    expect(() => normalizeName("___")).toThrow(PathValidationError);
  });
});

describe("normalizeFileName", () => {
  test("normalizes stem and lowercases extension", () => {
    expect(normalizeFileName("My Photo.JPG")).toBe("my_photo.jpg");
    expect(normalizeFileName("PcBuild.tar.gz")).toBe("pc_build.tar.gz");
    expect(normalizeFileName("CamelCase.PNG")).toBe("camel_case.png");
  });

  test("handles files without extension", () => {
    expect(normalizeFileName("Makefile")).toBe("makefile");
    expect(normalizeFileName("README")).toBe("readme");
  });

  test("handles dotfiles", () => {
    expect(normalizeFileName(".gitignore")).toBe(".gitignore");
  });
});

describe("validatePathSegment", () => {
  test("accepts valid segments", () => {
    expect(() => validatePathSegment("hello")).not.toThrow();
    expect(() => validatePathSegment("my_photos")).not.toThrow();
    expect(() => validatePathSegment("file.txt")).not.toThrow();
  });

  test("rejects empty segment", () => {
    expect(() => validatePathSegment("")).toThrow(PathValidationError);
  });

  test("rejects . and ..", () => {
    expect(() => validatePathSegment(".")).toThrow(PathValidationError);
    expect(() => validatePathSegment("..")).toThrow(PathValidationError);
  });

  test("rejects null bytes", () => {
    expect(() => validatePathSegment("hello\0world")).toThrow(PathValidationError);
  });

  test("rejects invalid characters", () => {
    expect(() => validatePathSegment("file<name")).toThrow(PathValidationError);
    expect(() => validatePathSegment('file"name')).toThrow(PathValidationError);
    expect(() => validatePathSegment("file|name")).toThrow(PathValidationError);
    expect(() => validatePathSegment("file?name")).toThrow(PathValidationError);
    expect(() => validatePathSegment("file*name")).toThrow(PathValidationError);
    expect(() => validatePathSegment("file\\name")).toThrow(PathValidationError);
  });

  test("rejects segments exceeding max length", () => {
    expect(() => validatePathSegment("a".repeat(256))).toThrow(PathValidationError);
    expect(() => validatePathSegment("a".repeat(255))).not.toThrow();
  });
});

describe("validatePath", () => {
  test("accepts valid paths", () => {
    expect(() => validatePath("/")).not.toThrow();
    expect(() => validatePath("/shared")).not.toThrow();
    expect(() => validatePath("/abc/def/ghi")).not.toThrow();
  });

  test("rejects paths not starting with /", () => {
    expect(() => validatePath("shared")).toThrow(PathValidationError);
    expect(() => validatePath("")).toThrow(PathValidationError);
  });

  test("rejects trailing slash", () => {
    expect(() => validatePath("/shared/")).toThrow(PathValidationError);
  });

  test("rejects double slashes", () => {
    expect(() => validatePath("/shared//folder")).toThrow(PathValidationError);
  });

  test("rejects path traversal", () => {
    expect(() => validatePath("/shared/../etc")).toThrow(PathValidationError);
  });
});

describe("joinPath", () => {
  test("joins segments with /", () => {
    expect(joinPath("a", "b", "c")).toBe("/a/b/c");
  });

  test("handles leading/trailing slashes on segments", () => {
    expect(joinPath("/data/", "/storage/", "/file")).toBe("/data/storage/file");
  });

  test("filters empty segments", () => {
    expect(joinPath("a", "", "b")).toBe("/a/b");
  });
});
