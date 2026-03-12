import { afterEach, describe, expect, test } from "bun:test";
import { optionalEnv, requiredEnv } from "./env";

describe("env", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe("requiredEnv", () => {
    test("returns the value when set", () => {
      process.env.TEST_VAR = "hello";
      expect(requiredEnv("TEST_VAR")).toBe("hello");
    });

    test("throws when variable is missing", () => {
      delete process.env.MISSING_VAR;
      expect(() => requiredEnv("MISSING_VAR")).toThrow(
        "Missing required environment variable: MISSING_VAR",
      );
    });

    test("throws when variable is empty string", () => {
      process.env.EMPTY_VAR = "";
      expect(() => requiredEnv("EMPTY_VAR")).toThrow();
    });
  });

  describe("optionalEnv", () => {
    test("returns the value when set", () => {
      process.env.OPT_VAR = "value";
      expect(optionalEnv("OPT_VAR", "default")).toBe("value");
    });

    test("returns default when variable is missing", () => {
      delete process.env.OPT_MISSING;
      expect(optionalEnv("OPT_MISSING", "fallback")).toBe("fallback");
    });
  });
});
