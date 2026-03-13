import { afterEach, describe, expect, test } from "bun:test";
import { optionalEnv, requiredEnv } from "./env";

describe("env — extended edge cases", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe("requiredEnv", () => {
    test("returns value with leading/trailing whitespace (does not trim)", () => {
      process.env.WHITESPACE_VAR = "  hello  ";
      expect(requiredEnv("WHITESPACE_VAR")).toBe("  hello  ");
    });

    test("returns value containing equals sign", () => {
      process.env.EQUALS_VAR = "key=value=other";
      expect(requiredEnv("EQUALS_VAR")).toBe("key=value=other");
    });

    test("returns value containing newlines", () => {
      process.env.NEWLINE_VAR = "line1\nline2\nline3";
      expect(requiredEnv("NEWLINE_VAR")).toBe("line1\nline2\nline3");
    });

    test("error message includes the variable name", () => {
      delete process.env.SPECIFIC_VAR;
      try {
        requiredEnv("SPECIFIC_VAR");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain("SPECIFIC_VAR");
      }
    });

    test("treats the string '0' as valid (truthy)", () => {
      process.env.ZERO_VAR = "0";
      expect(requiredEnv("ZERO_VAR")).toBe("0");
    });

    test("treats the string 'false' as valid", () => {
      process.env.FALSE_VAR = "false";
      expect(requiredEnv("FALSE_VAR")).toBe("false");
    });

    test("treats the string 'undefined' as valid", () => {
      process.env.UNDEF_STR = "undefined";
      expect(requiredEnv("UNDEF_STR")).toBe("undefined");
    });
  });

  describe("optionalEnv", () => {
    test("returns empty string if env var is set to empty string", () => {
      process.env.EMPTY_OPT = "";
      // ?? operator: "" is not nullish, so returns ""
      expect(optionalEnv("EMPTY_OPT", "default")).toBe("");
    });

    test("returns default for truly missing variable", () => {
      delete process.env.TRULY_MISSING;
      expect(optionalEnv("TRULY_MISSING", "fallback")).toBe("fallback");
    });

    test("returns default value exactly as provided", () => {
      delete process.env.MISSING_WITH_COMPLEX_DEFAULT;
      expect(optionalEnv("MISSING_WITH_COMPLEX_DEFAULT", "  spaces  ")).toBe("  spaces  ");
    });

    test("returns empty string default", () => {
      delete process.env.MISSING_EMPTY_DEFAULT;
      expect(optionalEnv("MISSING_EMPTY_DEFAULT", "")).toBe("");
    });
  });
});
