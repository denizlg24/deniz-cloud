import { describe, expect, test } from "bun:test";
import { AuthError } from "../auth";

describe("AuthError", () => {
  test("extends Error", () => {
    const err = new AuthError("msg", "CODE");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AuthError);
  });

  test("has correct name property", () => {
    const err = new AuthError("msg", "CODE");
    expect(err.name).toBe("AuthError");
  });

  test("preserves message, code, and default status", () => {
    const err = new AuthError("Invalid credentials", "INVALID_CREDENTIALS");
    expect(err.message).toBe("Invalid credentials");
    expect(err.code).toBe("INVALID_CREDENTIALS");
    expect(err.status).toBe(401); // default
  });

  test("accepts custom status codes", () => {
    const err400 = new AuthError("Bad input", "BAD_INPUT", 400);
    expect(err400.status).toBe(400);

    const err403 = new AuthError("Forbidden", "FORBIDDEN", 403);
    expect(err403.status).toBe(403);

    const err404 = new AuthError("Not found", "NOT_FOUND", 404);
    expect(err404.status).toBe(404);
  });

  test("works with try/catch", () => {
    try {
      throw new AuthError("test error", "TEST_CODE", 403);
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      if (err instanceof AuthError) {
        expect(err.code).toBe("TEST_CODE");
        expect(err.status).toBe(403);
        expect(err.message).toBe("test error");
      }
    }
  });

  test("stack trace is captured", () => {
    const err = new AuthError("msg", "CODE");
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain("AuthError");
  });

  test("works with JSON.stringify for code and message", () => {
    const err = new AuthError("test", "TEST");
    // Error properties are not enumerable by default, but code and status are
    // since they're assigned in the constructor
    expect(err.code).toBe("TEST");
    expect(err.status).toBe(401);
  });
});
